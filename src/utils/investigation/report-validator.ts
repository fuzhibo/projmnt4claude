import type { InvestigationReport, ValidationResult, ValidationError, ValidationWarning, ValidationRule } from './types';
import { PREFIX_MAP } from './types';
import { createLogger } from '../logger';

/**
 * 八项格式验证规则（investigation 和 init-requirement 共享）
 *
 * 规则表两端一致：此文件是唯一来源，init-requirement 应引用此模块。
 */
export const VALIDATION_RULES: ValidationRule[] = [
  { name: 'metadata-required',     condition: 'metadata 字段存在且非空',                               investigationAction: 'block', initAction: 'block'  },
  { name: 'root-cause-non-empty',  condition: 'rootCauseAnalysis 至少包含 1 项',                      investigationAction: 'block', initAction: 'block'  },
  { name: 'solution-non-empty',    condition: 'solutions 至少包含 1 项',                              investigationAction: 'block', initAction: 'block'  },
  { name: 'ca-sol-correspondence', condition: '每个 SOL 的 correspondsTo 指向有效的 CA 编号',         investigationAction: 'block', initAction: 'block'  },
  { name: 'checkpoint-prefix',     condition: '检查点前缀必须在 PREFIX_MAP 中定义',                   investigationAction: 'warn',  initAction: 'block'  },
  { name: 'checkpoint-belongsto',  condition: '检查点 belongsTo 必须指向有效的 SOL 编号',             investigationAction: 'warn',  initAction: 'block'  },
  { name: 'assessment-required',   condition: 'assessment 字段存在且 complexity 值合法',             investigationAction: 'warn',  initAction: 'warn'   },
  { name: 'id-format',             condition: 'CA 编号为 CA-NNN、SOL 编号为 SOL-NNN 格式',           investigationAction: 'warn',  initAction: 'block'  },
];

/**
 * 验证 InvestigationReport 的格式完整性
 * LOG-06: 验证结果日志增强
 */
export function validateReport(report: InvestigationReport): ValidationResult {
  const logger = createLogger('report-validator');

  // LOG-06: 验证输入摘要
  logger.debug('validateReport input', {
    hasMetadata: !!report.metadata,
    rootCauseCount: report.rootCauseAnalysis.length,
    solutionCount: report.solutions.length,
    checkpointCount: report.checkpoints.length,
  });

  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // Rule 1: metadata-required
  if (!report.metadata || !report.metadata.requirementSource) {
    errors.push({ rule: 'metadata-required', message: 'metadata.requirementSource 缺失或为空' });
  }

  // Rule 2: root-cause-non-empty
  if (!report.rootCauseAnalysis || report.rootCauseAnalysis.length === 0) {
    errors.push({ rule: 'root-cause-non-empty', message: 'rootCauseAnalysis 为空，至少需要 1 项原因分析' });
  }

  // Rule 3: solution-non-empty
  if (!report.solutions || report.solutions.length === 0) {
    errors.push({ rule: 'solution-non-empty', message: 'solutions 为空，至少需要 1 项解决方案' });
  }

  // Rule 8: id-format (先验证格式，后续规则依赖编号)
  // SOL-003: 警告规则推入 errors 数组，供 warningErrors 过滤
  const caIds = new Set<string>();
  const solIds = new Set<string>();
  const caFormatRe = /^CA-\d{3,}$/;
  const solFormatRe = /^SOL-\d{3,}$/;

  for (const ca of report.rootCauseAnalysis || []) {
    caIds.add(ca.id);
    if (!caFormatRe.test(ca.id)) {
      errors.push({ rule: 'id-format', message: `CA 编号格式不合法: ${ca.id}，期望 CA-NNN` });
    }
  }
  for (const sol of report.solutions || []) {
    solIds.add(sol.id);
    if (!solFormatRe.test(sol.id)) {
      errors.push({ rule: 'id-format', message: `SOL 编号格式不合法: ${sol.id}，期望 SOL-NNN` });
    }
  }

  // Rule 4: ca-sol-correspondence
  for (const sol of report.solutions || []) {
    if (sol.correspondsTo && !caIds.has(sol.correspondsTo)) {
      errors.push({
        rule: 'ca-sol-correspondence',
        message: `SOL ${sol.id} 的 correspondsTo "${sol.correspondsTo}" 未在原因分析中找到对应 CA`,
      });
    }
  }

  // Rule 5: checkpoint-prefix
  // SOL-003: 警告规则推入 errors 数组
  const validPrefixes = new Set(Object.keys(PREFIX_MAP));
  if (!report.checkpoints || report.checkpoints.length === 0) {
    errors.push({ rule: 'checkpoint-prefix', message: 'checkpoints 为空，至少需要 1 个检查点' });
  }
  for (const cp of report.checkpoints || []) {
    if (!validPrefixes.has(cp.prefix)) {
      errors.push({
        rule: 'checkpoint-prefix',
        message: `检查点前缀 "${cp.prefix}" 不在 PREFIX_MAP 中，有效值: ${[...validPrefixes].join(', ')}`,
      });
    }
  }

  // Rule 6: checkpoint-belongsto
  // SOL-003: 警告规则推入 errors 数组
  for (const cp of report.checkpoints || []) {
    if (cp.belongsTo && !solIds.has(cp.belongsTo)) {
      errors.push({
        rule: 'checkpoint-belongsto',
        message: `检查点 belongsTo "${cp.belongsTo}" 未在解决方案中找到对应 SOL`,
      });
    }
  }

  // Rule 7: assessment-required
  // SOL-003: 警告规则推入 errors 数组
  if (!report.assessment) {
    errors.push({ rule: 'assessment-required', message: 'assessment 缺失' });
  } else {
    const validComplexity = new Set(['low', 'medium', 'high']);
    if (!validComplexity.has(report.assessment.complexity)) {
      errors.push({
        rule: 'assessment-required',
        message: `assessment.complexity "${report.assessment.complexity}" 不合法，有效值: low, medium, high`,
      });
    }
  }

  // ✅ SOL-003: 按 investigationAction 分类错误
  // blockingErrors: 阻断性错误（必须重试）- 从 errors 数组过滤
  // warningErrors: 警告性错误（无需重试）- 从 errors 数组过滤
  const blockingErrors = errors.filter(e => {
    const rule = VALIDATION_RULES.find(r => r.name === e.rule);
    return rule?.investigationAction === 'block';
  });

  const warningErrors = errors.filter(e => {
    const rule = VALIDATION_RULES.find(r => r.name === e.rule);
    return rule?.investigationAction === 'warn';
  });

  // LOG-06: 验证结果详情
  logger.debug('validateReport result', {
    blockingErrorCount: blockingErrors.length,
    warningErrorCount: warningErrors.length,
    blockingErrors: blockingErrors.map(e => ({ rule: e.rule, message: e.message })),
    warnings: warningErrors.map(e => ({ rule: e.rule, message: e.message })),
  });

  return {
    valid: errors.length === 0,
    errors,
    warnings,  // 保留向后兼容
    blockingErrors,
    warningErrors,
  };
}

/**
 * 获取验证规则表（供两指令参考）
 */
export function getValidationRules(): ValidationRule[] {
  return [...VALIDATION_RULES];
}

/**
 * 获取指定规则
 */
export function getRule(name: string): ValidationRule | undefined {
  return VALIDATION_RULES.find(r => r.name === name);
}