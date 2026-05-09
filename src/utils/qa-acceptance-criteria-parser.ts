/**
 * QA Acceptance Criteria Parser
 *
 * Parses acceptance criteria from task descriptions and verifies them.
 * Based on hd-p12-qa-pre-gate-design.md §8 supplementary design.
 *
 * @module utils/qa-acceptance-criteria-parser
 */

import type {
  ParsedAcceptanceCriterion,
  AcceptanceCriteriaParserConfig,
  AcceptanceVerificationResult,
  AcceptanceLevel,
} from '../types/qa-acceptance-criteria.js';
import {
  DEFAULT_PARSER_CONFIG,
  createDefaultAcceptanceResult,
} from '../types/qa-acceptance-criteria.js';

/**
 * Acceptance Criteria Parser
 *
 * Parses acceptance criteria from task descriptions in markdown format.
 * Supports multiple criterion types:
 * - File count: "所有 3 个文件都已迁移"
 * - File migration: "文件迁移到使用 createIsolatedTestEnv"
 * - Function call: "beforeEach 中正确设置 env.mocks"
 * - Pattern match: "afterEach 中调用 env.cleanup()"
 */
export class AcceptanceCriteriaParser {
  private config: AcceptanceCriteriaParserConfig;

  constructor(config?: Partial<AcceptanceCriteriaParserConfig>) {
    this.config = { ...DEFAULT_PARSER_CONFIG, ...config };
  }

  /**
   * Parse acceptance criteria from task description
   *
   * Looks for "## 验收标准" or "## Acceptance Criteria" section
   * and parses each criterion item.
   *
   * @param description Task description (markdown)
   * @returns Parsed criteria array
   */
  parse(description: string): ParsedAcceptanceCriterion[] {
    const criteria: ParsedAcceptanceCriterion[] = [];

    // Find acceptance criteria section
    const sectionContent = this.extractCriteriaSection(description);
    if (!sectionContent) {
      return criteria;
    }

    // Parse each criterion line
    const lines = sectionContent.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();

      // Skip empty lines and section headers
      if (!trimmed || trimmed.startsWith('#')) continue;

      // Match list items: "- [ ] xxx" or "- [x] xxx" or "- xxx"
      const listMatch = trimmed.match(/^-\s*(?:\[[ x]\])?\s*(.+)$/i);
      if (listMatch) {
        const criterionText = listMatch[1];
        const parsed = this.parseCriterion(criterionText);
        if (parsed) {
          criteria.push(parsed);
        }
      }
    }

    return criteria;
  }

  /**
   * Extract acceptance criteria section from description
   */
  private extractCriteriaSection(description: string): string | null {
    // Match Chinese or English section header
    const sectionRegex = /^##\s*(验收标准|Acceptance\s*Criteria)\s*$/im;
    const match = description.match(sectionRegex);

    if (!match || match.index === undefined) {
      return null;
    }

    // Find the start of the section (after the header)
    const startIndex = match.index + match[0].length;

    // Find the end of the section (next ## header or end of string)
    const remainingText = description.slice(startIndex);
    const nextSectionMatch = remainingText.match(/\n##\s/);
    const endIndex = nextSectionMatch ? nextSectionMatch.index : remainingText.length;

    return remainingText.slice(0, endIndex).trim();
  }

  /**
   * Parse a single criterion line
   */
  private parseCriterion(text: string): ParsedAcceptanceCriterion | null {
    if (!text) return null;

    // Try to parse as file count criterion
    const fileCount = this.parseFileCountCriterion(text);
    if (fileCount) return fileCount;

    // Try to parse as file migration criterion
    const fileMigration = this.parseFileMigrationCriterion(text);
    if (fileMigration) return fileMigration;

    // Try to parse as function call criterion
    const functionCall = this.parseFunctionCallCriterion(text);
    if (functionCall) return functionCall;

    // Default to general criterion
    return {
      original: text,
      type: 'general',
    };
  }

  /**
   * Parse file count criterion
   *
   * Examples:
   * - "所有 3 个文件都已迁移"
   * - "3 个文件"
   * - "all 5 files"
   */
  private parseFileCountCriterion(text: string): ParsedAcceptanceCriterion | null {
    for (const pattern of this.config.fileCountPatterns) {
      const match = text.match(pattern);
      if (match) {
        const count = parseInt(match[1], 10);
        return {
          original: text,
          type: 'file_count',
          expected: count,
        };
      }
    }
    return null;
  }

  /**
   * Parse file migration criterion
   *
   * Examples:
   * - "文件迁移到使用 createIsolatedTestEnv"
   * - "migrated to new API"
   */
  private parseFileMigrationCriterion(text: string): ParsedAcceptanceCriterion | null {
    for (const pattern of this.config.fileMigrationPatterns) {
      const match = text.match(pattern);
      if (match) {
        return {
          original: text,
          type: 'file_migration',
          expected: match[1] || true,
        };
      }
    }
    return null;
  }

  /**
   * Parse function call criterion
   *
   * Examples:
   * - "beforeEach 中正确设置 env.mocks"
   * - "afterEach 中调用 env.cleanup()"
   */
  private parseFunctionCallCriterion(text: string): ParsedAcceptanceCriterion | null {
    for (const pattern of this.config.functionCallPatterns) {
      const match = text.match(pattern);
      if (match) {
        return {
          original: text,
          type: 'function_call',
          expected: match[1],
        };
      }
    }
    return null;
  }

  /**
   * Verify parsed criteria against actual state
   *
   * @param criteria Parsed criteria
   * @param context Verification context (file list, function calls, etc.)
   * @returns Updated criteria with satisfaction status
   */
  verify(
    criteria: ParsedAcceptanceCriterion[],
    context: VerificationContext
  ): ParsedAcceptanceCriterion[] {
    return criteria.map(criterion => this.verifyCriterion(criterion, context));
  }

  /**
   * Verify a single criterion
   */
  private verifyCriterion(
    criterion: ParsedAcceptanceCriterion,
    context: VerificationContext
  ): ParsedAcceptanceCriterion {
    switch (criterion.type) {
      case 'file_count':
        return this.verifyFileCount(criterion, context);
      case 'file_migration':
        return this.verifyFileMigration(criterion, context);
      case 'function_call':
        return this.verifyFunctionCall(criterion, context);
      default:
        return { ...criterion, satisfied: undefined };
    }
  }

  /**
   * Verify file count criterion
   */
  private verifyFileCount(
    criterion: ParsedAcceptanceCriterion,
    context: VerificationContext
  ): ParsedAcceptanceCriterion {
    const expected = criterion.expected as number;
    const actual = context.migratedFiles?.length ?? context.affectedFiles?.length ?? 0;
    const satisfied = actual >= expected;

    return {
      ...criterion,
      actual,
      satisfied,
      details: satisfied
        ? `文件数量满足要求: ${actual}/${expected}`
        : `文件数量不足: ${actual}/${expected}`,
    };
  }

  /**
   * Verify file migration criterion
   */
  private verifyFileMigration(
    criterion: ParsedAcceptanceCriterion,
    context: VerificationContext
  ): ParsedAcceptanceCriterion {
    const targetPattern = criterion.expected as string;
    const migratedCount = context.migratedFiles?.length ?? 0;
    const totalCount = context.affectedFiles?.length ?? 0;

    // If we have migrated files info, check if all are migrated
    const satisfied = totalCount > 0 ? migratedCount >= totalCount : undefined;

    return {
      ...criterion,
      actual: migratedCount,
      satisfied,
      details: satisfied !== undefined
        ? `迁移进度: ${migratedCount}/${totalCount} 文件使用 ${targetPattern}`
        : `无法验证迁移状态，需要提供 migratedFiles 上下文`,
    };
  }

  /**
   * Verify function call criterion
   */
  private verifyFunctionCall(
    criterion: ParsedAcceptanceCriterion,
    context: VerificationContext
  ): ParsedAcceptanceCriterion {
    const functionName = criterion.expected as string;
    const hasCall = context.functionCalls?.includes(functionName) ?? false;

    return {
      ...criterion,
      actual: hasCall,
      satisfied: hasCall ? true : undefined,
      details: hasCall
        ? `函数 ${functionName} 调用已验证`
        : `未找到函数 ${functionName} 的调用`,
    };
  }
}

/**
 * Verification context
 *
 * Provides actual state for criteria verification
 */
export interface VerificationContext {
  /** Affected files (from task.files or git diff) */
  affectedFiles?: string[];
  /** Migrated files (files that use new API/pattern) */
  migratedFiles?: string[];
  /** Function calls found in the code */
  functionCalls?: string[];
  /** Test results */
  testResults?: {
    passed: number;
    failed: number;
    total: number;
  };
  /** Build status */
  buildStatus?: {
    success: boolean;
    errors: string[];
  };
}

/**
 * Create default parser
 */
export function createAcceptanceCriteriaParser(
  config?: Partial<AcceptanceCriteriaParserConfig>
): AcceptanceCriteriaParser {
  return new AcceptanceCriteriaParser(config);
}

/**
 * Quick parse function
 */
export function parseAcceptanceCriteria(description: string): ParsedAcceptanceCriterion[] {
  const parser = new AcceptanceCriteriaParser();
  return parser.parse(description);
}

export default AcceptanceCriteriaParser;
