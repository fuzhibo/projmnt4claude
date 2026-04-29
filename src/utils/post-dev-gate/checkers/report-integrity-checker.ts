/**
 * Report Integrity Checker
 * 开发报告完整性检查器
 *
 * 职责:
 * - CP-001: 检查开发报告是否包含所有必需字段
 * - CP-002: 验证报告数据完整性和一致性
 * - CP-003: 计算报告完整性评分
 *
 * @module post-dev-phase-gate/checkers/report-integrity-checker
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  PostDevPhaseRule,
  PostDevPhaseCheckContext,
  PostDevPhaseCheckItemResult,
  ReportIntegrityCheckResult,
} from '../../../types/post-dev-phase-gate.js';
import type { DevReport } from '../../../types/harness.js';

/**
 * 检查报告完整性
 * R-OUTPUT-002: 开发报告完整性检查主函数
 *
 * @param rule - 检查规则
 * @param context - 检查上下文
 * @returns 检查结果
 */
export async function checkReportIntegrity(
  rule: PostDevPhaseRule,
  context: PostDevPhaseCheckContext
): Promise<PostDevPhaseCheckItemResult> {
  const startTime = Date.now();

  try {
    const config = rule.config as {
      requiredFields?: string[];
      minCompletenessScore?: number;
    } | undefined;

    const requiredFields = config?.requiredFields ?? getDefaultRequiredFields();
    const minCompletenessScore = config?.minCompletenessScore ?? 80;

    // 获取开发报告
    const devReport = context.devReport ?? await loadDevReport(context.cwd, context.taskId);

    if (!devReport) {
      return {
        checkId: 'report-integrity-check',
        checkName: '开发报告完整性检查',
        ruleId: rule.id,
        passed: false,
        severity: 'error',
        message: '未找到开发报告',
        suggestions: [
          '确保开发阶段已完成并生成了报告',
          `检查报告路径: .projmnt4claude/outputs/${context.taskId}/dev-report.json`,
        ],
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }

    // 分析报告完整性
    const integrityResult = analyzeReportIntegrity(devReport as unknown as Record<string, unknown>, requiredFields);

    // 判断是否通过
    const passed = integrityResult.complete &&
      integrityResult.completenessScore >= minCompletenessScore &&
      integrityResult.errors.length === 0;

    // 生成消息
    const message = generateIntegrityMessage(integrityResult, minCompletenessScore);

    // 生成建议
    const suggestions = generateIntegritySuggestions(integrityResult, requiredFields);

    return {
      checkId: 'report-integrity-check',
      checkName: '开发报告完整性检查',
      ruleId: rule.id,
      passed,
      severity: passed ? 'info' : rule.severity,
      message,
      details: integrityResult as unknown as Record<string, unknown>,
      suggestions,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
      autoFixable: false, // 报告完整性问题通常无法自动修复
    };
  } catch (error) {
    return {
      checkId: 'report-integrity-check',
      checkName: '开发报告完整性检查',
      ruleId: rule.id,
      passed: false,
      severity: 'error',
      message: `报告完整性检查失败: ${error instanceof Error ? error.message : String(error)}`,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * 获取默认必需字段列表
 * 基于 DevReport 类型定义
 */
function getDefaultRequiredFields(): string[] {
  return [
    'taskId',
    'status',
    'changes',
    'evidence',
    'checkpointsCompleted',
    'startTime',
    'endTime',
    'duration',
  ];
}

/**
 * 加载开发报告
 */
async function loadDevReport(cwd: string, taskId: string): Promise<DevReport | null> {
  const reportPath = path.join(
    cwd,
    '.projmnt4claude',
    'outputs',
    taskId,
    'dev-report.json'
  );

  try {
    if (!fs.existsSync(reportPath)) {
      return null;
    }

    const content = fs.readFileSync(reportPath, 'utf-8');
    return JSON.parse(content) as DevReport;
  } catch {
    return null;
  }
}

/**
 * 分析报告完整性
 */
function analyzeReportIntegrity(
  report: Record<string, unknown>,
  requiredFields: string[]
): ReportIntegrityCheckResult {
  const missingFields: string[] = [];
  const errors: string[] = [];

  // 检查必需字段是否存在且有效
  for (const field of requiredFields) {
    const value = getNestedValue(report, field);

    if (value === undefined || value === null) {
      missingFields.push(field);
      continue;
    }

    // 验证字段值的类型和有效性
    const fieldValidation = validateField(field, value);
    if (!fieldValidation.valid) {
      errors.push(`${field}: ${fieldValidation.error}`);
    }
  }

  // 计算完整性评分
  const totalFields = requiredFields.length;
  const presentFields = totalFields - missingFields.length;
  const baseScore = Math.round((presentFields / totalFields) * 100);

  // 根据错误数量降低评分
  const errorPenalty = errors.length * 10;
  const completenessScore = Math.max(0, baseScore - errorPenalty);

  return {
    complete: missingFields.length === 0 && errors.length === 0,
    requiredFields,
    missingFields,
    completenessScore,
    errors,
  };
}

/**
 * 获取嵌套对象值
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * 验证字段值
 * 基于 DevReport 类型定义验证
 */
function validateField(field: string, value: unknown): { valid: boolean; error?: string } {
  switch (field) {
    case 'taskId':
      if (typeof value !== 'string' || value.length === 0) {
        return { valid: false, error: 'taskId 必须是非空字符串' };
      }
      break;

    case 'status':
      const validStatuses = ['pending', 'running', 'success', 'failed', 'timeout'];
      if (typeof value !== 'string' || !validStatuses.includes(value)) {
        return { valid: false, error: `status 必须是以下之一: ${validStatuses.join(', ')}` };
      }
      break;

    case 'changes':
      if (!Array.isArray(value)) {
        return { valid: false, error: 'changes 必须是数组' };
      }
      break;

    case 'evidence':
      if (!Array.isArray(value)) {
        return { valid: false, error: 'evidence 必须是数组' };
      }
      break;

    case 'checkpointsCompleted':
      if (!Array.isArray(value)) {
        return { valid: false, error: 'checkpointsCompleted 必须是数组' };
      }
      break;

    case 'startTime':
    case 'endTime':
      if (typeof value !== 'string') {
        return { valid: false, error: `${field} 必须是字符串` };
      }
      // 验证 ISO 8601 格式
      const date = new Date(value as string);
      if (isNaN(date.getTime())) {
        return { valid: false, error: `${field} 必须是有效的 ISO 8601 日期格式` };
      }
      break;

    case 'duration':
      if (typeof value !== 'number' || value < 0) {
        return { valid: false, error: 'duration 必须是非负数字' };
      }
      break;
  }

  return { valid: true };
}

/**
 * 生成完整性检查消息
 */
function generateIntegrityMessage(
  result: ReportIntegrityCheckResult,
  minScore: number
): string {
  if (result.complete && result.completenessScore >= minScore) {
    return `报告完整性检查通过 (评分: ${result.completenessScore}/100)`;
  }

  const parts: string[] = [];
  if (result.missingFields.length > 0) {
    parts.push(`${result.missingFields.length} 个必需字段缺失`);
  }
  if (result.errors.length > 0) {
    parts.push(`${result.errors.length} 个字段验证错误`);
  }
  if (result.completenessScore < minScore) {
    parts.push(`完整性评分 ${result.completenessScore} 低于阈值 ${minScore}`);
  }

  return `报告完整性检查失败: ${parts.join(', ')}`;
}

/**
 * 生成完整性修复建议
 */
function generateIntegritySuggestions(
  result: ReportIntegrityCheckResult,
  requiredFields: string[]
): string[] {
  const suggestions: string[] = [];

  if (result.missingFields.length > 0) {
    suggestions.push(`添加缺失的字段: ${result.missingFields.join(', ')}`);
    for (const field of result.missingFields) {
      suggestions.push(`  - ${field}: ${getFieldDescription(field)}`);
    }
  }

  if (result.errors.length > 0) {
    suggestions.push('修复以下字段错误:');
    for (const error of result.errors) {
      suggestions.push(`  - ${error}`);
    }
  }

  if (result.completenessScore < 80) {
    suggestions.push('提高报告完整性: 确保所有阶段都正确记录了执行结果');
  }

  return suggestions;
}

/**
 * 获取字段描述
 */
function getFieldDescription(field: string): string {
  const descriptions: Record<string, string> = {
    taskId: '任务唯一标识符 (字符串)',
    status: '任务状态: pending, running, success, failed, timeout',
    changes: '代码变更列表 (字符串数组)',
    evidence: '证据文件路径列表 (字符串数组)',
    checkpointsCompleted: '已完成的检查点ID列表 (字符串数组)',
    startTime: '执行开始时间 (ISO 8601 格式)',
    endTime: '执行结束时间 (ISO 8601 格式)',
    duration: '执行时长 (毫秒, 非负数字)',
  };

  return descriptions[field] || '必需字段';
}

/**
 * 检查报告文件是否存在
 * R-OUTPUT-002-辅助函数
 */
export function checkReportExists(cwd: string, taskId: string): boolean {
  const reportPath = path.join(
    cwd,
    '.projmnt4claude',
    'outputs',
    taskId,
    'dev-report.json'
  );
  return fs.existsSync(reportPath);
}

/**
 * 获取报告完整性评分
 * R-OUTPUT-002-辅助函数
 */
export async function getReportCompletenessScore(
  cwd: string,
  taskId: string,
  requiredFields?: string[]
): Promise<number> {
  const report = await loadDevReport(cwd, taskId);
  if (!report) {
    return 0;
  }

  const fields = requiredFields ?? getDefaultRequiredFields();
  const result = analyzeReportIntegrity(report as unknown as Record<string, unknown>, fields);
  return result.completenessScore;
}

/**
 * 创建 ReportIntegrityChecker 类
 * IPostDevPhaseChecker 接口实现
 */
export class ReportIntegrityChecker {
  readonly id = 'report-integrity-checker';
  readonly name = '报告完整性检查器';
  readonly description = '检查开发报告是否包含所有必需字段';

  async check(
    rule: PostDevPhaseRule,
    context: PostDevPhaseCheckContext
  ): Promise<PostDevPhaseCheckItemResult> {
    return checkReportIntegrity(rule, context);
  }
}

// 导出默认实例
export const reportIntegrityChecker = new ReportIntegrityChecker();
