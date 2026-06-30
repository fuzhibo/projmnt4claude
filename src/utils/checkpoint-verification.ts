/**
 * 检查点产出验证模块
 * 用于检测假成功 — 检查点被标记为完成但没有对应的代码变更或产出物
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  CheckpointOutputCategory,
  VerificationStrategy,
  VerificationContext,
  VerificationOutput,
  VerificationRecord,
  VerificationSource,
} from '../types/checkpoint-verification.js';
import { getProjectDir } from './path.js';
import { writeTaskMeta } from './task.js';
import type { TaskMeta, CheckpointMetadata } from '../types/task.js';

/**
 * 类别到验证策略的映射
 * 定义每种检查点类别应该如何验证产出
 */
export const CATEGORY_STRATEGIES: Record<CheckpointOutputCategory, VerificationStrategy> = {
  implementation: {
    category: 'implementation',
    description: '实现类检查点：验证代码文件变更',
    evidenceTypes: ['file_exists', 'git_diff', 'code_change'],
    requiresHumanConfirmation: false,
    autoVerifyFunction: 'verifyImplementationCheckpoint',
  },
  testing: {
    category: 'testing',
    description: '测试类检查点：验证测试文件和测试通过',
    evidenceTypes: ['test_file_exists', 'test_passed', 'coverage_report'],
    requiresHumanConfirmation: false,
    autoVerifyFunction: 'verifyTestingCheckpoint',
  },
  documentation: {
    category: 'documentation',
    description: '文档类检查点：验证文档文件存在',
    evidenceTypes: ['file_exists', 'content_not_empty'],
    requiresHumanConfirmation: false,
    autoVerifyFunction: 'verifyDocumentationCheckpoint',
  },
  review: {
    category: 'review',
    description: '审核类检查点：验证审核记录存在',
    evidenceTypes: ['review_record', 'approval_status'],
    requiresHumanConfirmation: true,
    autoVerifyFunction: 'verifyReviewCheckpoint',
  },
  deployment: {
    category: 'deployment',
    description: '部署类检查点：验证部署产物',
    evidenceTypes: ['build_artifact', 'deployment_log'],
    requiresHumanConfirmation: false,
    autoVerifyFunction: 'verifyDeploymentCheckpoint',
  },
  configuration: {
    category: 'configuration',
    description: '配置类检查点：验证配置文件变更',
    evidenceTypes: ['file_exists', 'config_valid'],
    requiresHumanConfirmation: false,
    autoVerifyFunction: 'verifyConfigurationCheckpoint',
  },
  custom: {
    category: 'custom',
    description: '自定义检查点：需要人工验证',
    evidenceTypes: ['manual_verification'],
    requiresHumanConfirmation: true,
  },
};

/**
 * 从检查点描述推断类别
 */
export function inferCategoryFromDescription(description: string): CheckpointOutputCategory {
  const lowerDesc = description.toLowerCase();

  // 测试类关键词
  if (lowerDesc.includes('test') || lowerDesc.includes('测试') ||
      lowerDesc.includes('unit test') || lowerDesc.includes('单元测试') ||
      lowerDesc.includes('integration test') || lowerDesc.includes('集成测试') ||
      lowerDesc.includes('e2e') || lowerDesc.includes('端到端')) {
    return 'testing';
  }

  // 文档类关键词
  if (lowerDesc.includes('doc') || lowerDesc.includes('文档') ||
      lowerDesc.includes('readme') || lowerDesc.includes('comment') ||
      lowerDesc.includes('注释')) {
    return 'documentation';
  }

  // 审核类关键词
  if (lowerDesc.includes('review') || lowerDesc.includes('审核') ||
      lowerDesc.includes('[ai review]') || lowerDesc.includes('code review')) {
    return 'review';
  }

  // 部署类关键词
  if (lowerDesc.includes('deploy') || lowerDesc.includes('部署') ||
      lowerDesc.includes('build') || lowerDesc.includes('构建') ||
      lowerDesc.includes('release') || lowerDesc.includes('发布')) {
    return 'deployment';
  }

  // 配置类关键词
  if (lowerDesc.includes('config') || lowerDesc.includes('配置') ||
      lowerDesc.includes('setting') || lowerDesc.includes('设置') ||
      lowerDesc.includes('env') || lowerDesc.includes('环境变量')) {
    return 'configuration';
  }

  // 默认为实现类
  return 'implementation';
}

/**
 * 从检查点元数据推断类别
 */
export function inferCategoryFromCheckpoint(checkpoint: CheckpointMetadata): CheckpointOutputCategory {
  // 优先使用 category 字段
  if (checkpoint.category) {
    const cat = checkpoint.category.toLowerCase();
    if (cat === 'code_review' || cat === 'review') return 'review';
    if (cat === 'qa_verification' || cat === 'qa') return 'testing';
  }

  // 使用验证方法推断
  if (checkpoint.verification?.method) {
    const method = checkpoint.verification.method;
    if (method === 'unit_test' || method === 'integration_test' ||
        method === 'e2e_test' || method === 'functional_test') {
      return 'testing';
    }
    if (method === 'code_review' || method === 'architect_review') {
      return 'review';
    }
  }

  // 从描述推断
  return inferCategoryFromDescription(checkpoint.description);
}

/**
 * 检查点产出验证器
 * 核心验证模块，根据检查点类别选择验证策略
 */
export class CheckpointOutputVerifier {
  private cwd: string;

  constructor(cwd: string = process.cwd()) {
    this.cwd = cwd;
  }

  /**
   * 验证检查点产出
   * 主入口方法，根据来源和类别执行验证
   */
  async verify(context: VerificationContext): Promise<VerificationOutput> {
    const strategy = CATEGORY_STRATEGIES[context.category];
    const now = new Date().toISOString();

    // 基础验证记录
    const baseRecord: VerificationRecord = {
      source: context.source,
      result: 'unverified',
      verifiedBy: 'CheckpointOutputVerifier',
      verifiedAt: now,
    };

    // 如果 strategy 未定义或需要人工确认，标记为 skipped
    if (!strategy) {
      return {
        result: 'unverified',
        record: {
          ...baseRecord,
          result: 'unverified',
          failureReason: `未知的检查点类别: ${context.category}`,
        },
        warnings: [`检查点 ${context.checkpointId} 类别 ${context.category} 没有对应的验证策略`],
      };
    }

    if (strategy.requiresHumanConfirmation && context.source !== 'cli_manual') {
      return {
        result: 'skipped',
        record: {
          ...baseRecord,
          result: 'skipped',
          failureReason: '此类别检查点需要人工确认',
        },
        warnings: [`检查点 ${context.checkpointId} 需要人工确认`],
        suggestedActions: ['请手动验证此检查点'],
      };
    }

    // 根据类别执行验证
    try {
      switch (context.category) {
        case 'implementation':
          return await this.verifyImplementation(context, baseRecord);
        case 'testing':
          return await this.verifyTesting(context, baseRecord);
        case 'documentation':
          return await this.verifyDocumentation(context, baseRecord);
        case 'review':
          return await this.verifyReview(context, baseRecord);
        case 'deployment':
          return await this.verifyDeployment(context, baseRecord);
        case 'configuration':
          return await this.verifyConfiguration(context, baseRecord);
        default:
          return {
            result: 'unverified',
            record: {
              ...baseRecord,
              result: 'unverified',
              failureReason: '未知检查点类别',
            },
          };
      }
    } catch (error) {
      return {
        result: 'failed',
        record: {
          ...baseRecord,
          result: 'failed',
          failureReason: error instanceof Error ? error.message : String(error),
        },
        warnings: [`验证过程出错: ${error instanceof Error ? error.message : String(error)}`],
      };
    }
  }

  /**
   * 验证实现类检查点
   */
  private async verifyImplementation(
    context: VerificationContext,
    baseRecord: VerificationRecord
  ): Promise<VerificationOutput> {
    const warnings: string[] = [];
    const evidence: string[] = [];

    // 检查任务目录下是否有证据文件
    const projectDir = getProjectDir(this.cwd);
    const evidenceDir = path.join(projectDir, 'evidence', context.taskId);

    if (fs.existsSync(evidenceDir)) {
      const files = fs.readdirSync(evidenceDir);
      if (files.length > 0) {
        evidence.push(`证据目录存在 ${files.length} 个文件`);
      }
    }

    // 检查开发报告
    const reportPath = path.join(projectDir, 'reports', 'harness', context.taskId, 'dev-report.md');
    if (fs.existsSync(reportPath)) {
      evidence.push('开发报告存在');
    }

    // 检查 git 变更（如果有）
    const gitDir = path.join(this.cwd, '.git');
    if (fs.existsSync(gitDir)) {
      evidence.push('Git 仓库存在变更记录');
    }

    // 判断验证结果
    if (evidence.length > 0) {
      return {
        result: 'verified',
        record: {
          ...baseRecord,
          result: 'verified',
          evidence,
        },
      };
    }

    // 假成功检测：没有证据但标记为完成
    warnings.push(`检查点 ${context.checkpointId} 被标记为完成，但没有找到产出证据`);
    warnings.push('这可能是假成功 — 检查点状态与实际产出不符');

    return {
      result: 'unverified',
      record: {
        ...baseRecord,
        result: 'unverified',
        evidence: [],
        failureReason: '未找到产出证据',
      },
      warnings,
      suggestedActions: [
        '检查是否有对应的代码变更',
        '确认开发报告是否生成',
        '手动验证检查点是否真正完成',
      ],
    };
  }

  /**
   * 验证测试类检查点
   */
  private async verifyTesting(
    context: VerificationContext,
    baseRecord: VerificationRecord
  ): Promise<VerificationOutput> {
    const warnings: string[] = [];
    const evidence: string[] = [];

    // 检查测试报告
    const projectDir = getProjectDir(this.cwd);
    const qaReportPath = path.join(projectDir, 'reports', 'harness', context.taskId, 'qa-report.md');

    if (fs.existsSync(qaReportPath)) {
      evidence.push('QA 报告存在');
    }

    // 检查测试文件（从描述中提取可能的测试文件名）
    const testPatterns = ['.test.ts', '.spec.ts', '.test.js', '.spec.js'];
    const srcDir = path.join(this.cwd, 'src');

    let foundTestFiles: string[] = [];
    if (fs.existsSync(srcDir)) {
      foundTestFiles = this.findFilesWithPatterns(srcDir, testPatterns);
      if (foundTestFiles.length > 0) {
        evidence.push(`找到 ${foundTestFiles.length} 个测试文件`);
      }
    }

    // CP-008: 验证 expected 字段（覆盖率阈值等）
    const expected = context.existingVerification?.expected;
    if (expected) {
      const expectedResult = await verifyAgainstExpected(
        {
          testFiles: foundTestFiles,
          coverage: context.phaseData?.qaVerdict?.coverage,
        },
        expected,
        'testing'
      );
      if (!expectedResult.met) {
        warnings.push(`expected 验证失败: ${expectedResult.details}`);
      } else {
        evidence.push(`expected: ${expectedResult.details}`);
      }
    }

    if (evidence.length > 0 && warnings.length === 0) {
      return {
        result: 'verified',
        record: {
          ...baseRecord,
          result: 'verified',
          evidence,
        },
      };
    }

    if (warnings.length > 0) {
      return {
        result: 'failed',
        record: {
          ...baseRecord,
          result: 'failed',
          failureReason: warnings.join('; '),
        },
        warnings,
      };
    }

    warnings.push(`测试检查点 ${context.checkpointId} 没有找到测试证据`);

    return {
      result: 'unverified',
      record: {
        ...baseRecord,
        result: 'unverified',
        failureReason: '未找到测试证据',
      },
      warnings,
      suggestedActions: ['运行测试并生成测试报告'],
    };
  }

  /**
   * 验证文档类检查点
   */
  private async verifyDocumentation(
    context: VerificationContext,
    baseRecord: VerificationRecord
  ): Promise<VerificationOutput> {
    const evidence: string[] = [];

    // 检查常见文档文件
    const docPatterns = ['README.md', 'CHANGELOG.md', 'docs/', '.md'];
    const foundDocs: string[] = [];

    for (const pattern of docPatterns) {
      const fullPath = path.join(this.cwd, pattern);
      if (fs.existsSync(fullPath)) {
        foundDocs.push(pattern);
      }
    }

    if (foundDocs.length > 0) {
      evidence.push(`找到文档: ${foundDocs.join(', ')}`);
    }

    if (evidence.length > 0) {
      return {
        result: 'verified',
        record: {
          ...baseRecord,
          result: 'verified',
          evidence,
        },
      };
    }

    return {
      result: 'unverified',
      record: {
        ...baseRecord,
        result: 'unverified',
        failureReason: '未找到文档文件',
      },
      warnings: [`文档检查点 ${context.checkpointId} 没有找到文档证据`],
    };
  }

  /**
   * 验证审核类检查点
   */
  private async verifyReview(
    context: VerificationContext,
    baseRecord: VerificationRecord
  ): Promise<VerificationOutput> {
    const evidence: string[] = [];
    const warnings: string[] = [];

    // 检查审核报告
    const projectDir = getProjectDir(this.cwd);
    const crReportPath = path.join(projectDir, 'reports', 'harness', context.taskId, 'cr-report.md');

    if (fs.existsSync(crReportPath)) {
      evidence.push('代码审核报告存在');
    }

    // 检查阶段数据中的审核结论
    if (context.phaseData?.codeReviewVerdict) {
      evidence.push('存在审核结论');
    }

    // CP-008: 验证 expected 字段
    const expected = context.existingVerification?.expected;
    if (expected) {
      const expectedResult = await verifyAgainstExpected(
        {
          files: context.phaseData?.codeReviewVerdict?.filesReviewed,
          reportPath: crReportPath,
        },
        expected,
        'code_review'
      );
      if (!expectedResult.met) {
        warnings.push(`expected 验证失败: ${expectedResult.details}`);
      } else {
        evidence.push(`expected: ${expectedResult.details}`);
      }
    }

    if (evidence.length > 0 && warnings.length === 0) {
      return {
        result: 'verified',
        record: {
          ...baseRecord,
          result: 'verified',
          evidence,
        },
      };
    }

    if (warnings.length > 0) {
      return {
        result: 'failed',
        record: {
          ...baseRecord,
          result: 'failed',
          failureReason: warnings.join('; '),
        },
        warnings,
      };
    }

    return {
      result: 'unverified',
      record: {
        ...baseRecord,
        result: 'unverified',
        failureReason: '未找到审核证据',
      },
      warnings: [`审核检查点 ${context.checkpointId} 没有找到审核证据`],
    };
  }

  /**
   * 验证部署类检查点
   */
  private async verifyDeployment(
    context: VerificationContext,
    baseRecord: VerificationRecord
  ): Promise<VerificationOutput> {
    const evidence: string[] = [];

    // 检查构建产物
    const distDir = path.join(this.cwd, 'dist');
    if (fs.existsSync(distDir)) {
      const files = fs.readdirSync(distDir);
      if (files.length > 0) {
        evidence.push(`构建产物存在: ${files.length} 个文件`);
      }
    }

    if (evidence.length > 0) {
      return {
        result: 'verified',
        record: {
          ...baseRecord,
          result: 'verified',
          evidence,
        },
      };
    }

    return {
      result: 'unverified',
      record: {
        ...baseRecord,
        result: 'unverified',
        failureReason: '未找到部署产物',
      },
      warnings: [`部署检查点 ${context.checkpointId} 没有找到部署产物`],
    };
  }

  /**
   * 验证配置类检查点
   */
  private async verifyConfiguration(
    context: VerificationContext,
    baseRecord: VerificationRecord
  ): Promise<VerificationOutput> {
    const evidence: string[] = [];

    // 检查常见配置文件
    const configPatterns = [
      '.env', '.env.local', '.env.production',
      'config.json', 'config.yaml', 'config.yml',
      'settings.json',
    ];

    for (const pattern of configPatterns) {
      const fullPath = path.join(this.cwd, pattern);
      if (fs.existsSync(fullPath)) {
        evidence.push(`配置文件存在: ${pattern}`);
      }
    }

    if (evidence.length > 0) {
      return {
        result: 'verified',
        record: {
          ...baseRecord,
          result: 'verified',
          evidence,
        },
      };
    }

    return {
      result: 'unverified',
      record: {
        ...baseRecord,
        result: 'unverified',
        failureReason: '未找到配置文件',
      },
      warnings: [`配置检查点 ${context.checkpointId} 没有找到配置文件`],
    };
  }

  /**
   * 递归查找匹配模式的文件
   */
  private findFilesWithPatterns(dir: string, patterns: string[]): string[] {
    const results: string[] = [];

    const walk = (currentDir: string) => {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);

        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile()) {
          for (const pattern of patterns) {
            if (entry.name.includes(pattern) || entry.name.endsWith(pattern)) {
              results.push(fullPath);
              break;
            }
          }
        }
      }
    };

    walk(dir);
    return results;
  }
}

/**
 * 检测假成功检查点
 * 遍历任务的所有已完成检查点，验证是否有产出证据
 */
export async function detectFalseSuccess(
  task: TaskMeta,
  cwd: string = process.cwd()
): Promise<{
  falseSuccessCheckpoints: string[];
  warnings: string[];
  details: Array<{ checkpointId: string; category: CheckpointOutputCategory; reason: string }>;
}> {
  const falseSuccessCheckpoints: string[] = [];
  const warnings: string[] = [];
  const details: Array<{ checkpointId: string; category: CheckpointOutputCategory; reason: string }> = [];

  if (!task.checkpoints || task.checkpoints.length === 0) {
    return { falseSuccessCheckpoints, warnings, details };
  }

  const verifier = new CheckpointOutputVerifier(cwd);

  for (const checkpoint of task.checkpoints) {
    // 只检查已完成的检查点
    if (checkpoint.status !== 'completed') continue;

    const category = inferCategoryFromCheckpoint(checkpoint);
    const context: VerificationContext = {
      taskId: task.id,
      checkpointId: checkpoint.id,
      checkpointDescription: checkpoint.description,
      category,
      cwd,
      source: 'check_completed',
      existingVerification: checkpoint.verification ? {
        method: checkpoint.verification.method,
        result: checkpoint.verification.result,
        evidencePath: checkpoint.verification.evidencePath,
      } : undefined,
    };

    const output = await verifier.verify(context);

    if (output.result === 'unverified' || output.result === 'failed') {
      falseSuccessCheckpoints.push(checkpoint.id);
      if (output.warnings) {
        warnings.push(...output.warnings);
      }
      details.push({
        checkpointId: checkpoint.id,
        category,
        reason: output.record.failureReason || '未找到产出证据',
      });
    }
  }

  return { falseSuccessCheckpoints, warnings, details };
}

/**
 * 验证并记录检查点产出
 * 用于 CLI 手动标记和阶段自动同步
 */
export async function verifyAndRecordCheckpoint(
  task: TaskMeta,
  checkpointId: string,
  source: VerificationContext['source'],
  cwd: string = process.cwd(),
  phaseData?: VerificationContext['phaseData']
): Promise<VerificationOutput> {
  const checkpoint = task.checkpoints?.find(cp => cp.id === checkpointId);

  if (!checkpoint) {
    const now = new Date().toISOString();
    return {
      result: 'failed',
      record: {
        source,
        result: 'failed',
        verifiedBy: 'CheckpointOutputVerifier',
        verifiedAt: now,
        failureReason: `检查点 ${checkpointId} 不存在`,
      },
      warnings: [`检查点 ${checkpointId} 不存在`],
    };
  }

  const category = inferCategoryFromCheckpoint(checkpoint);
  const verifier = new CheckpointOutputVerifier(cwd);

  const context: VerificationContext = {
    taskId: task.id,
    checkpointId,
    checkpointDescription: checkpoint.description,
    category,
    cwd,
    source,
    existingVerification: checkpoint.verification ? {
      method: checkpoint.verification.method,
      result: checkpoint.verification.result,
      evidencePath: checkpoint.verification.evidencePath,
      expected: checkpoint.verification.expected,
    } : undefined,
    phaseData,
  };

  return verifier.verify(context);
}

/**
 * 检查点验证结果（简化版）
 * 用于 checkCompletedCheckpoints 函数返回
 */
export interface CheckpointValidationResult {
  /** 验证是否通过 */
  valid: boolean;
  /** 缺失产出列表 */
  missingOutputs: string[];
}

/**
 * 验证检查点完成状态（重载方法）
 * 用于 checkCompletedCheckpoints 兜底验证
 *
 * @param checkpoint - 检查点元数据
 * @param cwd - 工作目录
 * @returns 验证结果
 */
export async function verifyCheckpointOutput(
  checkpoint: CheckpointMetadata,
  cwd: string = process.cwd()
): Promise<CheckpointValidationResult> {
  const category = inferCategoryFromCheckpoint(checkpoint);
  const verifier = new CheckpointOutputVerifier(cwd);

  const context: VerificationContext = {
    taskId: 'unknown',
    checkpointId: checkpoint.id,
    checkpointDescription: checkpoint.description,
    category,
    cwd,
    source: 'check_completed',
    existingVerification: checkpoint.verification ? {
      method: checkpoint.verification.method,
      result: checkpoint.verification.result,
      evidencePath: checkpoint.verification.evidencePath,
    } : undefined,
  };

  const output = await verifier.verify(context);

  return {
    valid: output.result === 'verified',
    missingOutputs: output.record.failureReason ? [output.record.failureReason] : [],
  };
}

/**
 * 阶段同步验证结果
 * 用于阶段自动同步验证流程
 */
export interface PhaseSyncVerificationResult {
  /** 验证是否通过 */
  valid: boolean;
  /** 检查点 ID */
  checkpointId: string;
  /** 检查点类别 */
  category: CheckpointOutputCategory;
  /** 验证证据 */
  evidence: Array<{ type: string; description: string }>;
  /** 缺失产出列表 */
  missingOutputs: string[];
  /** 验证策略 */
  strategy?: {
    verifyFiles?: boolean;
    verifyCodeChange?: boolean;
    verifyTests?: boolean;
    verifyCoverage?: boolean;
    verifyReport?: boolean;
    verifyCommands?: boolean;
  };
  /** 是否需要人工验证 */
  requiresHuman?: boolean;
  /** 警告信息 */
  warnings?: string[];
}

/**
 * 获取验证来源
 * 根据阶段返回对应的验证来源标识
 */
export function getVerificationSource(
  phase: 'development' | 'code_review' | 'qa'
): VerificationSource {
  switch (phase) {
    case 'development':
      return 'phase_sync_dev';
    case 'code_review':
      return 'phase_sync_cr';
    case 'qa':
      return 'phase_sync_qa';
    default:
      return 'phase_sync';
  }
}

/**
 * 阶段同步验证
 * 在阶段完成后验证检查点产出，用于 syncCheckpointStatus
 *
 * @param task - 任务元数据
 * @param checkpoint - 检查点元数据
 * @param phase - 阶段名称
 * @param cwd - 工作目录
 * @param phaseData - 阶段数据（开发报告、审核结论、QA 结论）
 * @returns 阶段同步验证结果
 */
export async function verifyPhaseSyncCheckpoint(
  task: TaskMeta,
  checkpoint: CheckpointMetadata,
  phase: 'development' | 'code_review' | 'qa',
  cwd: string = process.cwd(),
  phaseData?: {
    devReport?: unknown;
    codeReviewVerdict?: unknown;
    qaVerdict?: unknown;
  }
): Promise<PhaseSyncVerificationResult> {
  const category = inferCategoryFromCheckpoint(checkpoint);
  const source = getVerificationSource(phase);

  // 跳过人工验证检查点
  if (checkpoint.requiresHuman) {
    return {
      valid: false,
      checkpointId: checkpoint.id,
      category,
      evidence: [],
      missingOutputs: [],
      requiresHuman: true,
      warnings: [`检查点 ${checkpoint.id} 需要人工验证，跳过自动同步`],
    };
  }

  const verifier = new CheckpointOutputVerifier(cwd);

  // CP-008: 类型安全的 phaseData 处理
  const context: VerificationContext = {
    taskId: task.id,
    checkpointId: checkpoint.id,
    checkpointDescription: checkpoint.description,
    category,
    cwd,
    source,
    existingVerification: checkpoint.verification ? {
      method: checkpoint.verification.method,
      result: checkpoint.verification.result,
      evidencePath: checkpoint.verification.evidencePath,
      expected: checkpoint.verification.expected,
    } : undefined,
    phaseData: phaseData ? {
      phase,
      devReport: (phaseData as { devReport?: unknown }).devReport as VerificationContext['phaseData'] extends { devReport?: infer T } | undefined ? T : never,
      codeReviewVerdict: (phaseData as { codeReviewVerdict?: unknown }).codeReviewVerdict as VerificationContext['phaseData'] extends { codeReviewVerdict?: infer T } | undefined ? T : never,
      qaVerdict: (phaseData as { qaVerdict?: unknown }).qaVerdict as VerificationContext['phaseData'] extends { qaVerdict?: infer T } | undefined ? T : never,
    } : { phase },
  };

  const output = await verifier.verify(context);

  // 转换为 PhaseSyncVerificationResult 格式
  const result: PhaseSyncVerificationResult = {
    valid: output.result === 'verified',
    checkpointId: checkpoint.id,
    category,
    evidence: output.record.evidence?.map(e => ({
      type: 'evidence',
      description: typeof e === 'string' ? e : String(e),
    })) || [],
    missingOutputs: output.record.failureReason ? [output.record.failureReason] : [],
    strategy: output.record.metadata?.strategy as PhaseSyncVerificationResult['strategy'],
    warnings: output.warnings,
  };

  return result;
}

// ============== checkCompletedCheckpoints 兜底验证 ==============

/**
 * 假成功警告
 * 用于报告检查点状态与产出不一致的情况
 */
export interface FalseSuccessWarning {
  /** 检查点 ID */
  checkpointId: string;
  /** 检查点描述 */
  description: string;
  /** 检查点类别 */
  category: CheckpointOutputCategory;
  /** 是否需要人工验证 */
  requiresHuman: boolean;
  /** 缺失产出列表 */
  missingOutputs: string[];
  /** 现有验证证据 */
  existingEvidence: Array<{ type: string; description: string }>;
}

/**
 * 验证证据类型
 */
export interface VerificationEvidence {
  /** 证据类型 */
  type: string;
  /** 证据描述 */
  description: string;
}

/**
 * 检查点完成验证结果
 * 用于 checkCompletedCheckpoints 返回
 */
export interface CheckpointCompletionResult {
  /** 已完成检查点 ID 列表（验证通过） */
  completed: string[];
  /** 假成功检查点列表 */
  falseSuccesses: FalseSuccessWarning[];
  /** 是否有假成功 */
  hasFalseSuccess: boolean;
}

/**
 * 验证人工检查点完成状态
 *
 * 检查验证记录中是否有证据。
 *
 * @param checkpoint - 检查点元数据
 * @returns 验证结果
 */
export function validateHumanCheckpointCompletion(
  checkpoint: CheckpointMetadata
): { valid: boolean; missingOutputs: string[] } {
  const verification = checkpoint.verification;

  // 检查是否有验证记录
  if (!verification) {
    return {
      valid: false,
      missingOutputs: ['缺少验证记录'],
    };
  }

  // 检查是否有验证证据
  if (!verification.evidencePath && !verification.details) {
    return {
      valid: false,
      missingOutputs: ['缺少验证证据'],
    };
  }

  // 检查验证结果是否为 passed
  if (verification.result && verification.result !== 'passed') {
    return {
      valid: false,
      missingOutputs: [`验证结果: ${verification.result}`],
    };
  }

  // 有验证证据，视为有效
  return { valid: true, missingOutputs: [] };
}

/**
 * 验证自动检查点完成状态
 *
 * 执行产出验证。
 *
 * @param checkpoint - 检查点元数据
 * @param taskId - 任务 ID
 * @param verifier - 验证器实例
 * @param cwd - 工作目录
 * @returns 验证结果
 */
export async function validateAutomatedCheckpointCompletion(
  checkpoint: CheckpointMetadata,
  taskId: string,
  verifier: CheckpointOutputVerifier,
  cwd: string
): Promise<{ valid: boolean; missingOutputs: string[] }> {
  const category = inferCategoryFromCheckpoint(checkpoint);
  const context: VerificationContext = {
    taskId,
    checkpointId: checkpoint.id,
    checkpointDescription: checkpoint.description,
    category,
    cwd,
    source: 'check_completed',
    existingVerification: checkpoint.verification ? {
      method: checkpoint.verification.method,
      result: checkpoint.verification.result,
      evidencePath: checkpoint.verification.evidencePath,
    } : undefined,
  };

  const output = await verifier.verify(context);

  return {
    valid: output.result === 'verified',
    missingOutputs: output.record.failureReason ? [output.record.failureReason] : [],
  };
}

/**
 * 输出假成功警告
 *
 * @param warnings - 假成功警告列表
 */
export function reportFalseSuccessWarnings(warnings: FalseSuccessWarning[]): void {
  // 空数组时不输出任何内容
  if (warnings.length === 0) {
    return;
  }

  console.warn('');
  console.warn('═══════════════════════════════════════════════════════════════');
  console.warn('⚠️  假成功检测：发现检查点状态与产出不一致');
  console.warn('═══════════════════════════════════════════════════════════════');
  console.warn('');

  for (const warning of warnings) {
    console.warn(`检查点: ${warning.checkpointId}`);
    console.warn(`描述: ${warning.description}`);
    console.warn(`类别: ${warning.category}`);
    console.warn(`类型: ${warning.requiresHuman ? '人工验证' : '自动验证'}`);
    console.warn('');

    if (warning.requiresHuman) {
      console.warn('问题: 状态为 completed 但缺少验证证据');
      console.warn('      人工验证检查点应有用户提供的验证记录');
      console.warn('');
      console.warn('建议操作:');
      console.warn('  1. 检查验证记录: projmnt4claude task show <taskId>');
      console.warn('  2. 补充验证记录: projmnt4claude task checkpoint <taskId> <cp-id> complete --note "验证说明"');
    } else {
      console.warn('问题: 状态为 completed 但产出验证失败');
      console.warn('      缺失产出:');
      for (const missing of warning.missingOutputs) {
        console.warn(`        - ${missing}`);
      }
      console.warn('');
      console.warn('建议操作:');
      console.warn('  1. 检查产出文件是否存在');
      console.warn('  2. 重新完成检查点对应的实现工作');
      console.warn('  3. 重新标记: projmnt4claude task checkpoint <taskId> <cp-id> complete');
    }

    if (warning.existingEvidence.length > 0) {
      console.warn('');
      console.warn('现有验证证据:');
      for (const evidence of warning.existingEvidence) {
        console.warn(`  - ${evidence.description}`);
      }
    }

    console.warn('───────────────────────────────────────────────────────────────');
    console.warn('');
  }

  console.warn('提示: 假成功检查点不计入已完成列表，需要重新验证或补充证据。');
  console.warn('═══════════════════════════════════════════════════════════════');
  console.warn('');
}

/**
 * 检查已完成的检查点（兜底验证）
 *
 * 作为检测兜底机制，验证产出并检测假成功。
 * 对每个 completed 状态检查点执行产出验证：
 * - 人工验证检查点：检查验证记录是否存在证据
 * - 自动验证检查点：执行产出验证
 *
 * 假成功检查点不计入已完成列表。
 *
 * @param task - 任务元数据
 * @param checkpointIds - 要检查的检查点 ID 列表（来自 SprintContract）
 * @param cwd - 工作目录
 * @returns 已完成检查点 ID 列表（验证通过）
 */
export async function checkCompletedCheckpoints(
  task: TaskMeta,
  checkpointIds: string[],
  cwd: string = process.cwd()
): Promise<CheckpointCompletionResult> {
  const completed: string[] = [];
  const falseSuccesses: FalseSuccessWarning[] = [];

  if (!task.checkpoints) {
    return { completed, falseSuccesses, hasFalseSuccess: false };
  }

  const verifier = new CheckpointOutputVerifier(cwd);

  for (const checkpointId of checkpointIds) {
    const checkpoint = task.checkpoints.find(cp => cp.id === checkpointId);
    if (!checkpoint) continue;

    // 状态检查：只处理已完成的检查点
    if (checkpoint.status !== 'completed') continue;

    // 兜底验证
    const requiresHuman = checkpoint.requiresHuman ?? false;
    let validationResult: { valid: boolean; missingOutputs: string[] };

    if (requiresHuman) {
      // 人工验证检查点：检查验证记录
      validationResult = validateHumanCheckpointCompletion(checkpoint);
    } else {
      // 自动验证检查点：执行产出验证
      validationResult = await validateAutomatedCheckpointCompletion(checkpoint, task.id, verifier, cwd);
    }

    if (!validationResult.valid) {
      // 假成功检测
      falseSuccesses.push({
        checkpointId,
        description: checkpoint.description,
        category: inferCategoryFromCheckpoint(checkpoint),
        requiresHuman,
        missingOutputs: validationResult.missingOutputs,
        existingEvidence: checkpoint.verification?.details ? [
          { type: checkpoint.verification.details.type, description: checkpoint.verification.details.userConfirmation || '无描述' }
        ] : [],
      });
      continue;
    }

    completed.push(checkpointId);
  }

  // 输出假成功警告
  if (falseSuccesses.length > 0) {
    reportFalseSuccessWarnings(falseSuccesses);
  }

  return {
    completed,
    falseSuccesses,
    hasFalseSuccess: falseSuccesses.length > 0,
  };
}

// ============== CheckpointStatusMismatchFixer (analyze --fix 验证) ==============

/**
 * 检查点验证结果条目
 * 用于 CheckpointStatusMismatchFixer 内部追踪
 */
interface CheckpointVerificationEntry {
  checkpoint: CheckpointMetadata;
  output: VerificationOutput;
}

/**
 * CheckpointStatusMismatchFixer 修复结果
 */
export interface CheckpointMismatchFixResult {
  /** 修复结果状态 */
  status: 'fixed' | 'skipped' | 'unfixable';
  /** 已标记完成的检查点数量 */
  completedCount: number;
  /** 已重新打开（假成功检测）的检查点数量 */
  reopenedCount: number;
  /** 需要人工验证的检查点数量 */
  humanPendingCount: number;
  /** 是否重新打开了任务 */
  taskReopened: boolean;
  /** 人工待验证检查点详情 */
  humanPendingDetails: Array<{
    checkpointId: string;
    description: string;
    category?: string;
    verificationSteps?: string[];
    expectedResult?: string;
  }>;
}

/**
 * 检查点状态不一致修复器
 *
 * 用于 analyze --fix 检测到 checkpoint_status_mismatch 时的验证与修复。
 * 验证流程：遍历 pending/completed 检查点，调用 CheckpointOutputVerifier.verify，
 * 然后分类处理结果。
 *
 * 处理策略：
 * - 所有验证通过时标记 completed 并记录证据
 * - 自动检查点失败时 reopen 任务重置检查点
 * - 人工检查点待验证时记录并汇报等待用户验证
 *
 * 验证来源标识为 analyze_fix
 */
export class CheckpointStatusMismatchFixer {
  private verifier: CheckpointOutputVerifier;
  private cwd: string;

  constructor(cwd: string = process.cwd()) {
    this.cwd = cwd;
    this.verifier = new CheckpointOutputVerifier(cwd);
  }

  /**
   * 修复检查点状态不一致
   *
   * @param task - 任务元数据（会被直接修改）
   * @returns 修复结果
   */
  async fix(task: TaskMeta): Promise<CheckpointMismatchFixResult> {
    if (!task.checkpoints || task.checkpoints.length === 0) {
      return {
        status: 'skipped',
        completedCount: 0,
        reopenedCount: 0,
        humanPendingCount: 0,
        taskReopened: false,
        humanPendingDetails: [],
      };
    }

    const now = new Date().toISOString();
    const entries: CheckpointVerificationEntry[] = [];

    // 1. 验证所有 pending 和 completed 检查点
    for (const checkpoint of task.checkpoints) {
      if (checkpoint.status !== 'pending' && checkpoint.status !== 'completed') continue;

      const category = inferCategoryFromCheckpoint(checkpoint);
      const context: VerificationContext = {
        taskId: task.id,
        checkpointId: checkpoint.id,
        checkpointDescription: checkpoint.description,
        category,
        cwd: this.cwd,
        source: 'analyze_fix',
        existingVerification: checkpoint.verification ? {
          method: checkpoint.verification.method,
          result: checkpoint.verification.result,
          evidencePath: checkpoint.verification.evidencePath,
        } : undefined,
      };

      const output = await this.verifier.verify(context);
      entries.push({ checkpoint, output });
    }

    // 2. 分类检查点
    const verifiedEntries = entries.filter(e => e.output.result === 'verified');
    const failedEntries = entries.filter(e =>
      e.output.result === 'unverified' || e.output.result === 'failed'
    );
    const skippedEntries = entries.filter(e => e.output.result === 'skipped');

    const autoFailed = failedEntries.filter(e => !(e.checkpoint.requiresHuman ?? false));
    const humanPending = failedEntries.filter(e => (e.checkpoint.requiresHuman ?? false));
    // skipped 的检查点（如 review 类别）也归入人工待验证
    const humanSkipped = skippedEntries.filter(e => (e.checkpoint.requiresHuman ?? false));

    // 3. 处理验证通过的检查点 — 标记 completed 并记录证据
    let completedCount = 0;
    for (const entry of verifiedEntries) {
      const cp = task.checkpoints.find(c => c.id === entry.checkpoint.id);
      if (!cp) continue;

      cp.status = 'completed';
      cp.updatedAt = now;
      cp.verification = {
        method: 'automated',
        result: 'passed (auto-completed by analyze-fix: verified output)',
        verifiedAt: now,
        verifiedBy: 'analyze-fix',
        details: {
          type: 'automated',
          missingOutputs: [],
        },
      };
      if (entry.output.record.evidence) {
        cp.verification.evidencePath = entry.output.record.evidence.join('; ');
      }
      completedCount++;
    }

    // 4. 处理自动检查点失败 — reopen 任务并重置检查点
    let reopenedCount = 0;
    let taskReopened = false;

    if (autoFailed.length > 0) {
      console.log('');
      console.log(`  ⚠️ 发现 ${autoFailed.length} 个自动验证检查点产出验证失败`);
      console.log('     将重新打开任务以重新执行');
      console.log('');

      task.status = 'open';
      task.updatedAt = now;
      taskReopened = true;

      for (const entry of autoFailed) {
        const cp = task.checkpoints.find(c => c.id === entry.checkpoint.id);
        if (!cp) continue;

        cp.status = 'pending';
        cp.updatedAt = now;
        cp.note = `${cp.note ? cp.note + '; ' : ''}analyze-fix 检测到假成功，重新打开`;
        cp.verification = {
          method: 'automated',
          result: 'failed',
          verifiedAt: now,
          verifiedBy: 'analyze-fix',
          details: {
            type: 'automated',
            missingOutputs: entry.output.record.failureReason
              ? [entry.output.record.failureReason]
              : [],
          },
        };
        reopenedCount++;
      }

      writeTaskMeta(task, this.cwd);
      console.log('  ✓ 任务已重新打开');
      console.log('     请重新执行任务以完成检查点');
    }

    // 5. 处理人工检查点待验证 — 记录并汇报
    const allHumanPending = [...humanPending, ...humanSkipped];
    const humanPendingDetails: CheckpointMismatchFixResult['humanPendingDetails'] = [];
    let humanPendingCount = 0;

    if (allHumanPending.length > 0) {
      console.log('');
      console.log('  ═══════════════════════════════════════════════════════════');
      console.log('  ⚠️  人工验证检查点待验证');
      console.log('  ═══════════════════════════════════════════════════════════');
      console.log('');
      console.log(`  任务 ${task.id} 有 ${allHumanPending.length} 个检查点需要人工验证：`);
      console.log('');

      for (let i = 0; i < allHumanPending.length; i++) {
        const { checkpoint } = allHumanPending[i]!;
        console.log(`  ${i + 1}. [${checkpoint.id}] ${checkpoint.description}`);
        console.log(`     类别: ${checkpoint.category ?? 'implementation'}`);

        if (checkpoint.verification?.steps) {
          console.log('     验证步骤:');
          for (const step of checkpoint.verification.steps) {
            console.log(`       - ${step}`);
          }
        }

        if (checkpoint.verification?.expected) {
          console.log(`     预期结果: ${checkpoint.verification.expected}`);
        }

        console.log('');

        humanPendingDetails.push({
          checkpointId: checkpoint.id,
          description: checkpoint.description,
          category: checkpoint.category,
          verificationSteps: checkpoint.verification?.steps,
          expectedResult: checkpoint.verification?.expected,
        });
        humanPendingCount++;
      }

      console.log('  ───────────────────────────────────────────────────────────');
      console.log('  完成验证后，请执行以下命令标记检查点完成：');
      console.log('');
      console.log(`    projmnt4claude task checkpoint ${task.id} <checkpoint-id> complete --note "验证结果"`);
      console.log('');
      console.log('  ═══════════════════════════════════════════════════════════');
      console.log('');
    }

    // 6. 如果有变更，写入 meta
    if (completedCount > 0 && !taskReopened) {
      task.updatedAt = now;
      writeTaskMeta(task, this.cwd);
    }

    // 7. 确定最终状态
    if (taskReopened) {
      return {
        status: 'fixed',
        completedCount,
        reopenedCount,
        humanPendingCount,
        taskReopened: true,
        humanPendingDetails,
      };
    }

    if (completedCount > 0) {
      console.log(`  ✅ 已标记 ${completedCount} 个检查点为完成（产出验证通过）`);
      return {
        status: 'fixed',
        completedCount,
        reopenedCount,
        humanPendingCount,
        taskReopened: false,
        humanPendingDetails,
      };
    }

    if (humanPendingCount > 0) {
      return {
        status: 'unfixable',
        completedCount,
        reopenedCount,
        humanPendingCount,
        taskReopened: false,
        humanPendingDetails,
      };
    }

    return {
      status: 'skipped',
      completedCount: 0,
      reopenedCount: 0,
      humanPendingCount: 0,
      taskReopened: false,
      humanPendingDetails: [],
    };
  }
}

// ============== CP-008: System B B类门禁验证 ==============

import type {
  SystemBPrefix,
  SystemBVerificationStrategy,
} from '../types/checkpoint-verification.js';
import { SYSTEM_B_CATEGORY_STRATEGIES } from '../types/checkpoint-verification.js';

/**
 * 从检查点描述提取 System B 前缀
 *
 * @param description - 检查点描述
 * @returns System B 前缀或 undefined
 */
export function extractSystemBPrefix(description: string): SystemBPrefix | undefined {
  const lowerDesc = description.toLowerCase();

  if (lowerDesc.includes('[ai review]') || lowerDesc.includes('ai-review')) {
    return 'ai-review';
  }
  if (lowerDesc.includes('[ai qa]') || lowerDesc.includes('ai-qa')) {
    return 'ai-qa';
  }
  if (lowerDesc.includes('[human qa]') || lowerDesc.includes('human-qa')) {
    return 'human-qa';
  }
  if (lowerDesc.includes('[script]') || lowerDesc.includes('script-')) {
    return 'script';
  }

  return undefined;
}

/**
 * 获取 System B 验证策略
 *
 * @param checkpoint - 检查点元数据
 * @returns System B 验证策略或 undefined
 */
export function getSystemBStrategy(
  checkpoint: CheckpointMetadata
): SystemBVerificationStrategy | undefined {
  const prefix = extractSystemBPrefix(checkpoint.description);
  if (!prefix) return undefined;

  return SYSTEM_B_CATEGORY_STRATEGIES[prefix];
}

/**
 * expected 字段验证结果
 */
export interface ExpectedVerificationResult {
  /** 是否符合 expected */
  met: boolean;
  /** 详细说明 */
  details: string;
}

/**
 * 验证产出是否符合 expected 定义（CP-008 核心）
 *
 * @param output - 检查点产出数据
 * @param expected - expected 字段内容
 * @param category - 检查点类别
 * @returns 验证结果
 */
export async function verifyAgainstExpected(
  output: {
    files?: string[];
    codeChange?: { description: string; files?: string[] };
    testFiles?: string[];
    coverage?: number;
    reportPath?: string;
    commandsExecuted?: string[];
  },
  expected: string | undefined,
  category: string
): Promise<ExpectedVerificationResult> {
  // 无 expected 定义，跳过验证
  if (!expected) {
    return { met: true, details: '无 expected 定义，跳过验证' };
  }

  const lowerExpected = expected.toLowerCase();

  // 根据类别解析 expected
  switch (category) {
    case 'code_review':
    case 'review':
      return verifyCodeReviewExpected(output, lowerExpected);

    case 'qa_verification':
    case 'testing':
      return verifyQAExpected(output, lowerExpected);

    case 'evaluation':
      return verifyEvaluationExpected(output, lowerExpected);

    case 'script_execution':
    case 'script':
      return verifyScriptExpected(output, lowerExpected);

    default:
      return { met: true, details: `未知分类 ${category}，跳过 expected 验证` };
  }
}

/**
 * 验证 code_review 类 expected
 *
 * @param output - 产出数据
 * @param expected - expected 内容（小写）
 * @returns 验证结果
 */
function verifyCodeReviewExpected(
  output: {
    files?: string[];
    codeChange?: { description: string; files?: string[] };
    reportPath?: string;
  },
  expected: string
): ExpectedVerificationResult {
  // expected 可能是：报告包含特定内容、代码变更符合标准

  // 检查是否有代码变更产出
  if (expected.includes('代码变更') || expected.includes('code change')) {
    if (!output.codeChange || !output.codeChange.files?.length) {
      return { met: false, details: '缺少代码变更产出' };
    }
  }

  // 检查是否有报告产出
  if (expected.includes('报告') || expected.includes('report')) {
    if (!output.reportPath) {
      return { met: false, details: '缺少 review 报告产出' };
    }
  }

  // 检查特定文件
  if (expected.includes('文件') || expected.includes('file')) {
    if (!output.files?.length) {
      return { met: false, details: '缺少文件产出' };
    }
  }

  return { met: true, details: 'expected 验证通过' };
}

/**
 * 验证 qa_verification 类 expected
 *
 * @param output - 产出数据
 * @param expected - expected 内容（小写）
 * @returns 验证结果
 */
function verifyQAExpected(
  output: {
    testFiles?: string[];
    coverage?: number;
  },
  expected: string
): ExpectedVerificationResult {
  // expected 可能是：覆盖率 ≥ 80%、测试通过率 ≥ 90%

  // 解析覆盖率阈值
  const coverageMatch = expected.match(/(?:≥|>=)\s*(\d+)%|覆盖率\s*(\d+)%/);
  if (coverageMatch) {
    const threshold = parseInt(coverageMatch[1] ?? coverageMatch[2] ?? '0');
    if (output.coverage === undefined || output.coverage < threshold) {
      return {
        met: false,
        details: `覆盖率 ${output.coverage ?? '未知'}% 未达到阈值 ${threshold}%`,
      };
    }
  }

  // 检查测试文件产出
  if (expected.includes('测试') || expected.includes('test')) {
    if (!output.testFiles?.length) {
      return { met: false, details: '缺少测试文件产出' };
    }
  }

  return { met: true, details: 'expected 验证通过' };
}

/**
 * 验证 evaluation 类 expected
 *
 * @param output - 产出数据
 * @param expected - expected 内容（小写）
 * @returns 验证结果
 */
function verifyEvaluationExpected(
  output: {
    reportPath?: string;
    files?: string[];
  },
  expected: string
): ExpectedVerificationResult {
  // expected 可能是：评估结论为 PASS、有评估报告

  if (expected.includes('报告') || expected.includes('report')) {
    if (!output.reportPath) {
      return { met: false, details: '缺少评估报告产出' };
    }
  }

  if (expected.includes('文件') || expected.includes('file')) {
    if (!output.files?.length) {
      return { met: false, details: '缺少评估文件产出' };
    }
  }

  return { met: true, details: 'expected 验证通过' };
}

/**
 * 验证 script 类 expected
 *
 * @param output - 产出数据
 * @param expected - expected 内容（小写）
 * @returns 验证结果
 */
function verifyScriptExpected(
  output: {
    commandsExecuted?: string[];
    reportPath?: string;
  },
  expected: string
): ExpectedVerificationResult {
  // expected 可能是：脚本执行成功、有执行结果

  if (expected.includes('执行') || expected.includes('execute') || expected.includes('命令')) {
    if (!output.commandsExecuted?.length) {
      return { met: false, details: '缺少脚本执行结果' };
    }
  }

  return { met: true, details: 'expected 验证通过' };
}

/**
 * B类门禁验证结果
 */
export interface PostGateResult {
  /** 是否通过 */
  passed: boolean;
  /** 各检查点验证结果 */
  results: Array<{
    checkpointId: string;
    valid: boolean;
    evidence: string[];
    missingOutputs: string[];
    strategy?: SystemBVerificationStrategy;
  }>;
}

/**
 * code_review 阶段 B类门禁
 *
 * @param verdict - Code Review 结论
 * @param checkpoints - 相关检查点
 * @param cwd - 工作目录
 * @returns B类门禁结果
 */
export async function executeCodeReviewPostGate(
  verdict: {
    filesReviewed?: string[];
    reportPath?: string;
    summary?: string;
  },
  checkpoints: CheckpointMetadata[],
  _cwd: string
): Promise<PostGateResult> {
  const results: PostGateResult['results'] = [];

  for (const checkpoint of checkpoints) {
    // 只处理 code_review 类检查点
    const prefix = extractSystemBPrefix(checkpoint.description);
    if (prefix !== 'ai-review') {
      continue;
    }

    const strategy = SYSTEM_B_CATEGORY_STRATEGIES['ai-review'];
    const evidence: string[] = [];
    const missingOutputs: string[] = [];

    // 验证文件产出
    if (strategy.verifyFiles && verdict.filesReviewed?.length) {
      evidence.push(`文件审查: ${verdict.filesReviewed.length} 个文件`);
    } else if (strategy.verifyFiles) {
      missingOutputs.push('缺少文件审查记录');
    }

    // 验证报告产出
    if (strategy.verifyReport && verdict.reportPath) {
      evidence.push(`报告: ${verdict.reportPath}`);
    } else if (strategy.verifyReport) {
      missingOutputs.push('缺少 review 报告');
    }

    // 验证 expected
    const expected = checkpoint.verification?.expected;
    if (strategy.verifyExpected && expected) {
      const expectedResult = await verifyAgainstExpected(
        {
          files: verdict.filesReviewed,
          reportPath: verdict.reportPath,
        },
        expected,
        'code_review'
      );
      if (!expectedResult.met) {
        missingOutputs.push(`expected 验证失败: ${expectedResult.details}`);
      } else {
        evidence.push(`expected: ${expectedResult.details}`);
      }
    }

    results.push({
      checkpointId: checkpoint.id,
      valid: missingOutputs.length === 0,
      evidence,
      missingOutputs,
      strategy,
    });
  }

  return {
    passed: results.every(r => r.valid),
    results,
  };
}

/**
 * qa 阶段 B类门禁
 *
 * @param verdict - QA 结论
 * @param checkpoints - 相关检查点
 * @param cwd - 工作目录
 * @returns B类门禁结果
 */
export async function executeQAPostGate(
  verdict: {
    testFiles?: string[];
    coverage?: number;
    passed?: boolean;
    summary?: string;
  },
  checkpoints: CheckpointMetadata[],
  _cwd: string
): Promise<PostGateResult> {
  const results: PostGateResult['results'] = [];

  for (const checkpoint of checkpoints) {
    // 只处理 qa 相关检查点
    const prefix = extractSystemBPrefix(checkpoint.description);
    if (prefix !== 'ai-qa' && prefix !== 'human-qa') {
      continue;
    }

    const strategy = SYSTEM_B_CATEGORY_STRATEGIES[prefix || 'ai-qa'];
    const evidence: string[] = [];
    const missingOutputs: string[] = [];

    // 验证测试文件
    if (strategy.verifyTests && verdict.testFiles?.length) {
      evidence.push(`测试文件: ${verdict.testFiles.length} 个`);
    } else if (strategy.verifyTests) {
      missingOutputs.push('缺少测试文件');
    }

    // 验证覆盖率
    if (strategy.verifyCoverage && verdict.coverage !== undefined) {
      evidence.push(`覆盖率: ${verdict.coverage}%`);
    } else if (strategy.verifyCoverage) {
      missingOutputs.push('缺少覆盖率数据');
    }

    // 验证 expected
    const expected = checkpoint.verification?.expected;
    if (strategy.verifyExpected && expected) {
      const expectedResult = await verifyAgainstExpected(
        {
          testFiles: verdict.testFiles,
          coverage: verdict.coverage,
        },
        expected,
        'qa_verification'
      );
      if (!expectedResult.met) {
        missingOutputs.push(`expected 验证失败: ${expectedResult.details}`);
      } else {
        evidence.push(`expected: ${expectedResult.details}`);
      }
    }

    results.push({
      checkpointId: checkpoint.id,
      valid: missingOutputs.length === 0,
      evidence,
      missingOutputs,
      strategy,
    });
  }

  return {
    passed: results.every(r => r.valid),
    results,
  };
}

/**
 * evaluation 阶段 B类门禁
 *
 * @param verdict - Evaluation 结论
 * @param checkpoints - 相关检查点
 * @param cwd - 工作目录
 * @returns B类门禁结果
 */
export async function executeEvaluationPostGate(
  verdict: {
    evalFiles?: string[];
    reportPath?: string;
    summary?: string;
    conclusion?: string;
  },
  checkpoints: CheckpointMetadata[],
  _cwd: string
): Promise<PostGateResult> {
  const results: PostGateResult['results'] = [];

  for (const checkpoint of checkpoints) {
    // 只处理 script 类检查点
    const prefix = extractSystemBPrefix(checkpoint.description);
    if (prefix !== 'script') {
      continue;
    }

    const strategy = SYSTEM_B_CATEGORY_STRATEGIES['script'];
    const evidence: string[] = [];
    const missingOutputs: string[] = [];

    // 验证评估文件
    if (strategy.verifyFiles && verdict.evalFiles?.length) {
      evidence.push(`评估文件: ${verdict.evalFiles.length} 个`);
    }

    // 验证报告
    if (strategy.verifyReport && verdict.reportPath) {
      evidence.push(`报告: ${verdict.reportPath}`);
    }

    // 验证 expected
    const expected = checkpoint.verification?.expected;
    if (strategy.verifyExpected && expected) {
      const expectedResult = await verifyAgainstExpected(
        {
          files: verdict.evalFiles,
          reportPath: verdict.reportPath,
        },
        expected,
        'evaluation'
      );
      if (!expectedResult.met) {
        missingOutputs.push(`expected 验证失败: ${expectedResult.details}`);
      } else {
        evidence.push(`expected: ${expectedResult.details}`);
      }
    }

    results.push({
      checkpointId: checkpoint.id,
      valid: missingOutputs.length === 0,
      evidence,
      missingOutputs,
      strategy,
    });
  }

  return {
    passed: results.every(r => r.valid),
    results,
  };
}

/**
 * Re-export System B strategies
 */
export { SYSTEM_B_CATEGORY_STRATEGIES } from '../types/checkpoint-verification.js';
