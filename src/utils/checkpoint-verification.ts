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
  VerificationResult,
} from '../types/checkpoint-verification.js';
import { getProjectDir } from './path.js';
import { readTaskMeta } from './task.js';
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

    // 如果需要人工确认，标记为 skipped
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

    if (fs.existsSync(srcDir)) {
      const foundTestFiles = this.findFilesWithPatterns(srcDir, testPatterns);
      if (foundTestFiles.length > 0) {
        evidence.push(`找到 ${foundTestFiles.length} 个测试文件`);
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
    } : undefined,
    phaseData,
  };

  return verifier.verify(context);
}
