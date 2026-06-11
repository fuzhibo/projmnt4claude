/**
 * Pre-Phase Gate Types
 * 阶段前质量门禁类型定义
 *
 * 职责:
 * - 定义阶段前检查的类型和接口
 * - 支持 development → code_review → qa → evaluation 各阶段前的质量检查
 *
 * @module pre-phase-gate
 */

import type { TaskMeta, FailureType } from './task.js';
import type { DevReport, CodeReviewVerdict, QAVerdict } from './harness.js';

/**
 * 执行阶段
 */
export type ExecutionPhase = 'development' | 'code_review' | 'qa' | 'evaluation';

/**
 * 阶段前门禁配置
 */
export interface PrePhaseGateConfig {
  /** 是否启用门禁 */
  enabled: boolean;
  /** 各阶段门禁配置 */
  phaseGates: Map<ExecutionPhase, PhaseGateConfig>;
  /** 全局最低质量分数 */
  minQualityScore: number;
  /** 失败时是否停止 */
  stopOnFailure: boolean;
  /** 是否生成详细报告 */
  generateReport: boolean;
}

/**
 * 单个阶段门禁配置
 */
export interface PhaseGateConfig {
  /** 阶段名称 */
  phase: ExecutionPhase;
  /** 是否启用 */
  enabled: boolean;
  /** 该阶段的检查规则 */
  rules: PhaseGateRule[];
  /** 最低质量分数 */
  minQualityScore: number;
  /** 是否为阻塞性 (失败则阻止进入该阶段) */
  blocking: boolean;
}

/**
 * 阶段门禁规则类型
 */
export type PhaseGateRuleType =
  | 'prerequisite_check'     // 前置条件检查
  | 'artifact_validation'    // 产物验证
  | 'quality_score'          // 质量分数检查
  | 'status_verification'    // 状态验证
  | 'checkpoint_validation'  // 检查点验证
  | 'dependency_check'       // 依赖检查
  | 'custom';                // 自定义规则

/**
 * 阶段门禁规则
 */
export interface PhaseGateRule {
  /** 规则ID */
  id: string;
  /** 规则类型 */
  type: PhaseGateRuleType;
  /** 规则名称 */
  name: string;
  /** 规则描述 */
  description: string;
  /** 是否启用 */
  enabled: boolean;
  /** 是否为阻塞规则 */
  blocking: boolean;
  /**
   * 失败类型分类
   * - 'A': Task Foundation - 任务数据有效性检查，失败需中断流水线
   * - 'B': Phase Artifact - 阶段输出质量检查，失败需回退到阶段起点重试
   * 阶段前门禁默认为 'A' 类（检查任务数据本身有效性）
   */
  failureType?: FailureType;
  /** 规则配置参数 */
  config?: Record<string, unknown>;
}

/**
 * 阶段前门禁上下文
 */
export interface PrePhaseGateContext {
  /** 任务ID */
  taskId: string;
  /** 工作目录 */
  cwd: string;
  /** 目标阶段 */
  targetPhase: ExecutionPhase;
  /** 任务元数据 */
  task: TaskMeta;
  /** 开发报告 (进入 code_review 阶段时需要) */
  devReport?: DevReport;
  /** 代码审核结果 (进入 qa 阶段时需要) */
  codeReviewVerdict?: CodeReviewVerdict;
  /** QA结果 (进入 evaluation 阶段时需要) */
  qaVerdict?: QAVerdict;
  /** 共享数据 */
  sharedData: Map<string, unknown>;
}

/**
 * 阶段前门禁检查结果
 */
export interface PhaseGateCheckResult {
  /** 规则ID */
  ruleId: string;
  /** 规则名称 */
  ruleName: string;
  /** 是否通过 */
  passed: boolean;
  /** 检查结果消息 */
  message: string;
  /** 详细信息 */
  details?: Record<string, unknown>;
  /** 执行时长 (毫秒) */
  duration: number;
  /** 执行时间戳 */
  timestamp: string;
  /** CP-GATE: 错误类型分类 (format, test, import, type, lint, timeout, api, ai_output, other) */
  failureType?: string;
  /** CP-GATE: 规则级修复建议 */
  suggestions?: string[];
  /** CP-GATE: 失败等级 (ERROR | WARNING | INFO) */
  severity?: 'ERROR' | 'WARNING' | 'INFO';
}

/**
 * 阶段前门禁决策结果
 */
export type PhaseGateDecision = 'ALLOW' | 'BLOCK' | 'WARN';

/**
 * 阶段前门禁运行结果
 */
export interface PrePhaseGateResult {
  /** 任务ID */
  taskId: string;
  /** 目标阶段 */
  targetPhase: ExecutionPhase;
  /** 门禁决策 */
  decision: PhaseGateDecision;
  /** 是否允许进入阶段 */
  allowed: boolean;
  /** 规则检查结果列表 */
  ruleResults: PhaseGateCheckResult[];
  /** 通过的规则数 */
  passedRules: number;
  /** 失败的规则数 */
  failedRules: number;
  /** 阻塞失败数 */
  blockingFailures: number;
  /** 警告数 */
  warningCount: number;
  /** 总执行时长 (毫秒) */
  duration: number;
  /** 执行时间戳 */
  timestamp: string;
  /** 建议 */
  recommendations: string[];
}

/**
 * 阶段前门禁报告
 */
export interface PrePhaseGateReport {
  /** 报告ID */
  reportId: string;
  /** 任务ID */
  taskId: string;
  /** 目标阶段 */
  targetPhase: ExecutionPhase;
  /** 生成时间 */
  generatedAt: string;
  /** 门禁结果 */
  result: PrePhaseGateResult;
  /** 建议 */
  recommendations: string[];
  /** 元数据 */
  metadata: {
    version: string;
    checkerVersion: string;
    rulesExecuted: number;
  };
}

/**
 * 阶段前门禁规则处理器函数类型
 */
export type PhaseGateRuleHandler = (
  context: PrePhaseGateContext,
  rule: PhaseGateRule
) => Promise<PhaseGateCheckResult>;

/**
 * 阶段进入条件验证结果
 */
export interface PhaseEntryValidation {
  /** 是否满足进入条件 */
  canEnter: boolean;
  /** 未满足的条件列表 */
  unmetConditions: string[];
  /** 建议操作 */
  suggestedActions: string[];
}

/**
 * 默认阶段门禁配置
 */
export const DEFAULT_PHASE_GATE_CONFIG: PrePhaseGateConfig = {
  enabled: true,
  phaseGates: new Map(),
  minQualityScore: 60,
  stopOnFailure: false,
  generateReport: true,
};

/**
 * development 阶段默认规则
 */
export const DEFAULT_DEV_PHASE_RULES: PhaseGateRule[] = [
  {
    id: 'R-DEV-PRE-001',
    type: 'prerequisite_check',
    name: '开发前置条件检查',
    description: '检查任务是否满足开始开发的条件',
    enabled: true,
    blocking: true,
    failureType: 'A',
  },
  {
    id: 'R-DEV-PRE-002',
    type: 'status_verification',
    name: '任务状态验证',
    description: '验证任务当前状态是否允许开始开发',
    enabled: true,
    blocking: true,
    failureType: 'A',
  },
  {
    id: 'R-DEV-PRE-003',
    type: 'quality_score',
    name: '开发前质量分数检查',
    description: '检查任务质量分数是否达到开发要求',
    enabled: true,
    blocking: false,
    failureType: 'A',
    config: { minScore: 50 },
  },
];

/**
 * code_review 阶段默认规则
 */
export const DEFAULT_CR_PHASE_RULES: PhaseGateRule[] = [
  {
    id: 'R-CR-PRE-001',
    type: 'artifact_validation',
    name: '开发产物验证',
    description: '验证开发阶段是否成功完成并产生必要产物',
    enabled: true,
    blocking: true,
    failureType: 'A',
  },
  {
    id: 'R-CR-PRE-002',
    type: 'prerequisite_check',
    name: '开发报告检查',
    description: '检查开发报告是否存在且状态为成功',
    enabled: true,
    blocking: true,
    failureType: 'A',
  },
  {
    id: 'R-CR-PRE-003',
    type: 'checkpoint_validation',
    name: '开发检查点验证',
    description: '验证开发阶段检查点是否已完成',
    enabled: true,
    blocking: false,
    failureType: 'A',
  },
];

/**
 * qa 阶段默认规则
 */
export const DEFAULT_QA_PHASE_RULES: PhaseGateRule[] = [
  {
    id: 'R-QA-PRE-001',
    type: 'prerequisite_check',
    name: '代码审核结果检查',
    description: '验证代码审核是否通过',
    enabled: true,
    blocking: true,
    failureType: 'A',
  },
  {
    id: 'R-QA-PRE-002',
    type: 'artifact_validation',
    name: '代码审核产物验证',
    description: '验证代码审核产物是否完整',
    enabled: true,
    blocking: true,
    failureType: 'A',
  },
  {
    id: 'R-QA-PRE-003',
    type: 'quality_score',
    name: 'QA前质量分数检查',
    description: '检查任务质量分数是否达到QA要求',
    enabled: true,
    blocking: false,
    failureType: 'A',
    config: { minScore: 60 },
  },
];

/**
 * evaluation 阶段默认规则
 */
export const DEFAULT_EVAL_PHASE_RULES: PhaseGateRule[] = [
  {
    id: 'R-EVAL-PRE-001',
    type: 'prerequisite_check',
    name: 'QA结果检查',
    description: '验证QA阶段是否成功完成',
    enabled: true,
    blocking: true,
    failureType: 'A',
  },
  {
    id: 'R-EVAL-PRE-002',
    type: 'prerequisite_check',
    name: '全阶段完成检查',
    description: '验证所有前置阶段是否已完成',
    enabled: true,
    blocking: true,
    failureType: 'A',
  },
  {
    id: 'R-EVAL-PRE-003',
    type: 'quality_score',
    name: '评估前质量分数检查',
    description: '检查任务质量分数是否达到评估要求',
    enabled: true,
    blocking: false,
    failureType: 'A',
    config: { minScore: 70 },
  },
];

/**
 * 创建默认阶段门禁配置
 */
export function createDefaultPhaseGateConfig(): PrePhaseGateConfig {
  const phaseGates = new Map<ExecutionPhase, PhaseGateConfig>();

  phaseGates.set('development', {
    phase: 'development',
    enabled: true,
    rules: DEFAULT_DEV_PHASE_RULES,
    minQualityScore: 50,
    blocking: true,
  });

  phaseGates.set('code_review', {
    phase: 'code_review',
    enabled: true,
    rules: DEFAULT_CR_PHASE_RULES,
    minQualityScore: 60,
    blocking: true,
  });

  phaseGates.set('qa', {
    phase: 'qa',
    enabled: true,
    rules: DEFAULT_QA_PHASE_RULES,
    minQualityScore: 60,
    blocking: true,
  });

  phaseGates.set('evaluation', {
    phase: 'evaluation',
    enabled: true,
    rules: DEFAULT_EVAL_PHASE_RULES,
    minQualityScore: 70,
    blocking: true,
  });

  return {
    enabled: true,
    phaseGates,
    minQualityScore: 60,
    stopOnFailure: false,
    generateReport: true,
  };
}
