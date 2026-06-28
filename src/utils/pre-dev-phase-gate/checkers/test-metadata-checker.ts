/**
 * Test Metadata Checker
 * 测试元数据检查器
 *
 * 职责:
 * - 校验 TaskMeta 中测试相关元数据字段完整性
 * - 确保 testFramework/testCommand/techStack/projectTestConventions 非空
 * - 可选校验声明值与框架探测结果一致性
 * - 失败类型: A（中断任务，需用户补全元数据）
 *
 * @module pre-dev-phase-gate/checkers/test-metadata-checker
 */

import type {
  PreDevPhaseCheckContext,
  PreDevPhaseCheckItemResult,
  PreDevPhaseRule,
} from '../../../types/pre-dev-phase-gate.js';

/**
 * 测试元数据字段定义
 */
interface TestMetadataFields {
  testFramework: string | undefined;
  testCommand: string | undefined;
  techStack: string | undefined;
  projectTestConventions: string | undefined;
}

/**
 * 单个字段检查结果
 */
interface FieldCheckResult {
  field: string;
  label: string;
  present: boolean;
  value?: string;
}

/**
 * 测试元数据检查器配置
 */
export interface TestMetadataCheckerConfig {
  /** 是否启用 */
  enabled: boolean;
}

/**
 * 默认测试元数据检查器配置
 */
export const DEFAULT_TEST_METADATA_CHECKER_CONFIG: TestMetadataCheckerConfig = {
  enabled: true,
};

/**
 * 测试元数据检查器
 *
 * CP-META-001: testFramework 字段非空
 * CP-META-002: testCommand 字段非空
 * CP-META-003: techStack 字段非空
 * CP-META-004: projectTestConventions 字段非空
 *
 * R-DEV-PRE-008: 失败类型为 A（中断任务）
 * 所有 4 个字段必须填写，任一为空立即中断任务。
 */
export class TestMetadataChecker {
  readonly id = 'R-DEV-PRE-008';
  readonly name = '测试元数据检查';
  readonly description = '检查 TaskMeta 中测试相关元数据字段是否完整';
  readonly failureType = 'A' as const;

  private config: TestMetadataCheckerConfig;

  constructor(config?: Partial<TestMetadataCheckerConfig>) {
    this.config = { ...DEFAULT_TEST_METADATA_CHECKER_CONFIG, ...config };
  }

  /**
   * 执行测试元数据检查
   */
  async check(
    context: PreDevPhaseCheckContext
  ): Promise<PreDevPhaseCheckItemResult> {
    const startTime = Date.now();
    const timestamp = new Date().toISOString();

    if (!this.config.enabled) {
      return {
        checkId: 'test-metadata-check',
        checkName: this.name,
        ruleId: this.id,
        passed: true,
        severity: 'info',
        message: '测试元数据检查已禁用',
        duration: Date.now() - startTime,
        timestamp,
      };
    }

    const metadata = this.extractMetadata(context);
    const fieldResults = this.checkFields(metadata);
    const missingFields = fieldResults.filter(r => !r.present);

    const allPresent = missingFields.length === 0;
    const duration = Date.now() - startTime;

    if (allPresent) {
      // 声明-探测一致性校验 (CP-GATE-004, CP-GATE-006)
      const detection = context.frameworkDetection;
      if (detection?.detected && detection?.frameworkReady) {
        const declaredFramework = (metadata.testFramework || '').toLowerCase();
        const detectedType = (detection.type || '').toLowerCase();
        const isMatch = declaredFramework.includes(detectedType) || detectedType.includes(declaredFramework);
        if (!isMatch) {
          return {
            checkId: 'test-metadata-check',
            checkName: this.name,
            ruleId: this.id,
            passed: false,
            severity: 'error',
            message: `测试框架声明与探测不一致: 声明="${metadata.testFramework}", 探测="${detection.type}"`,
            details: {
              fields: fieldResults,
              allPresent: true,
              failureType: this.failureType,
              declaredFramework: metadata.testFramework,
              detectedFramework: detection.type,
              mismatch: true,
            },
            suggestions: [
              `将 task.meta.json 中的 testFramework 从 "${metadata.testFramework}" 修改为 "${detection.type}"`,
              '或重新运行测试框架检测以更新探测结果',
            ],
            duration,
            timestamp,
          };
        }
      }

      return {
        checkId: 'test-metadata-check',
        checkName: this.name,
        ruleId: this.id,
        passed: true,
        severity: 'info',
        message: `测试元数据完整: testFramework=${metadata.testFramework}, testCommand=${metadata.testCommand}`,
        details: {
          fields: fieldResults,
          allPresent: true,
          failureType: this.failureType,
        },
        duration,
        timestamp,
      };
    }

    const missingLabels = missingFields.map(f => f.label).join('、');

    return {
      checkId: 'test-metadata-check',
      checkName: this.name,
      ruleId: this.id,
      passed: false,
      severity: 'error',
      message: `测试元数据不完整: 缺少 ${missingLabels}`,
      details: {
        fields: fieldResults,
        missingFields: missingFields.map(f => f.field),
        allPresent: false,
        failureType: this.failureType,
      },
      suggestions: [
        '在 task.meta.json 中补充缺失的测试元数据字段',
        `缺少: ${missingLabels}`,
        'testFramework: 测试框架名称，如 jest / pytest / go test',
        'testCommand: 测试运行命令，如 npx jest --config jest.config.js',
        'techStack: 技术栈描述，如 Node.js 18 + TypeScript 5.x',
        'projectTestConventions: 测试约定，如 __tests__/ 目录, *.test.ts',
      ],
      duration,
      timestamp,
    };
  }

  /**
   * 从任务元数据提取测试字段
   */
  private extractMetadata(context: PreDevPhaseCheckContext): TestMetadataFields {
    return {
      testFramework: context.task.testFramework,
      testCommand: context.task.testCommand,
      techStack: context.task.techStack,
      projectTestConventions: context.task.projectTestConventions,
    };
  }

  /**
   * 逐字段检查
   */
  private checkFields(metadata: TestMetadataFields): FieldCheckResult[] {
    return [
      {
        field: 'testFramework',
        label: '测试框架',
        present: this.isNonEmpty(metadata.testFramework),
        value: metadata.testFramework,
      },
      {
        field: 'testCommand',
        label: '测试命令',
        present: this.isNonEmpty(metadata.testCommand),
        value: metadata.testCommand,
      },
      {
        field: 'techStack',
        label: '技术栈',
        present: this.isNonEmpty(metadata.techStack),
        value: metadata.techStack,
      },
      {
        field: 'projectTestConventions',
        label: '测试约定',
        present: this.isNonEmpty(metadata.projectTestConventions),
        value: metadata.projectTestConventions,
      },
    ];
  }

  /**
   * 判断字符串值非空（排除空白字符）
   */
  private isNonEmpty(value: string | undefined): boolean {
    return value !== undefined && value.trim().length > 0;
  }
}

/**
 * 创建测试元数据检查器实例
 */
export function createTestMetadataChecker(
  config?: Partial<TestMetadataCheckerConfig>
): TestMetadataChecker {
  return new TestMetadataChecker(config);
}

/**
 * 快速测试元数据检查
 */
export async function checkTestMetadata(
  context: PreDevPhaseCheckContext,
  config?: Partial<TestMetadataCheckerConfig>
): Promise<PreDevPhaseCheckItemResult> {
  const checker = new TestMetadataChecker(config);
  return checker.check(context);
}

/**
 * 规则处理器 - 用于 PreDevPhaseGateCoordinator
 */
export async function checkTestMetadataRule(
  rule: PreDevPhaseRule,
  context: PreDevPhaseCheckContext
): Promise<PreDevPhaseCheckItemResult> {
  const checker = new TestMetadataChecker(
    rule.config as Partial<TestMetadataCheckerConfig>
  );
  return checker.check(context);
}

export default TestMetadataChecker;
