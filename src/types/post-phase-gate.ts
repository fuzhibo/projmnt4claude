/**
 * Post-Phase Gate Types
 * 阶段后质量门禁类型定义
 *
 * 职责:
 * - 定义阶段后检查的类型和接口
 * - 在任务完成各执行阶段后进行质量检查，确保阶段产出符合要求
 * - 支持 development → code_review → qa → evaluation 各阶段后的完成检查
 *
 * @module post-phase-gate
 */

import type { TaskMeta } from './task.js';
import type { DevReport, CodeReviewVerdict, QAVerdict } from './harness.js';

/**
 * 执行阶段
 */
export type ExecutionPhase = 'development' | 'code_review' | 'qa' | 'evaluation';

/**
 * 阶段后门禁配置
 */
export interface PostPhaseGateConfig {
  /** 是否启用门禁 */
  enabled: boolean;
  /** 各阶段门禁配置 */
  phaseGates: Map<ExecutionPhase, PostPhaseGateConfigEntry>;
  /** 全局最低质量分数 */
  minQualityScore: number;
  /** 失败时是否停止 */
  stopOnFailure: boolean;
  /** 是否生成详细报告 */
  generateReport: boolean;
}

/**
 * 单个阶段后门禁配置
 */
export interface PostPhaseGateConfigEntry {
  /** 阶段名称 */
  phase: ExecutionPhase;
  /** 是否启用 */
  enabled: boolean;
  /** 该阶段的检查规则 */
  rules: PostPhaseGateRule[];
  /** 最低质量分数 */
  minQualityScore: number;
  /** 是否为阻塞性 (失败则阻止进入下一阶段) */
  blocking: boolean;
  /** 阶段完成所需最小检查点完成率 (0-1) */
  minCheckpointCompletionRate: number;
}

/**
 * 阶段后门禁规则类型
 */
export type PostPhaseGateRuleType =
  | 'completion_verification'  // 阶段完成验证
  | 'artifact_validation'      // 产物验证
  | 'quality_score'            // 质量分数检查
  | 'checkpoint_completion'    // 检查点完成度验证
  | 'test_results'             // 测试结果验证
  | 'review_approval'          // 审核批准验证
  | 'deliverable_check'        // 可交付物检查
  | 'custom';                  // 自定义规则

/**
 * 阶段后门禁规则
 */
export interface PostPhaseGateRule {
  /** 规则ID */
  id: string;
  /** 规则类型 */
  type: PostPhaseGateRuleType;
  /** 规则名称 */
  name: string;
  /** 规则描述 */
  description: string;
  /** 是否启用 */
  enabled: boolean;
  /** 是否为阻塞规则 */
  blocking: boolean;
  /** 规则配置参数 */
  config?: Record<string, unknown>;
}

/**
 * 阶段后门禁上下文
 */
export interface PostPhaseGateContext {
  /** 任务ID */
  taskId: string;
  /** 工作目录 */
  cwd: string;
  /** 当前阶段 */
  currentPhase: ExecutionPhase;
  /** 任务元数据 */
  task: TaskMeta;
  /** 开发报告 (development 阶段完成后) */
  devReport?: DevReport;
  /** 代码审核结果 (code_review 阶段完成后) */
  codeReviewVerdict?: CodeReviewVerdict;
  /** QA结果 (qa 阶段完成后) */
  qaVerdict?: QAVerdict;
  /** 共享数据 */
  sharedData: Map<string, unknown>;
}

/**
 * 阶段后门禁检查结果
 */
export interface PostPhaseGateCheckResult {
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
}

/**
 * 阶段后门禁决策结果
 */
export type PostPhaseGateDecision = 'COMPLETE' | 'INCOMPLETE' | 'NEEDS_FIX';

/**
 * 阶段后门禁运行结果
 */
export interface PostPhaseGateResult {
  /** 任务ID */
  taskId: string;
  /** 当前阶段 */
  currentPhase: ExecutionPhase;
  /** 门禁决策 */
  decision: PostPhaseGateDecision;
  /** 是否允许退出阶段 */
  canExit: boolean;
  /** 规则检查结果列表 */
  ruleResults: PostPhaseGateCheckResult[];
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
  /** 阶段产出总结 */
  deliverables: PhaseDeliverable[];
}

/**
 * 阶段产出物
 */
export interface PhaseDeliverable {
  /** 产出物ID */
  id: string;
  /** 产出物名称 */
  name: string;
  /** 产出物类型 */
  type: 'code' | 'test' | 'document' | 'report' | 'artifact' | 'other';
  /** 产出物状态 */
  status: 'complete' | 'partial' | 'missing';
  /** 产出物路径/位置 */
  location?: string;
  /** 产出物描述 */
  description?: string;
}

/**
 * 阶段后门禁报告
 */
export interface PostPhaseGateReport {
  /** 报告ID */
  reportId: string;
  /** 任务ID */
  taskId: string;
  /** 当前阶段 */
  currentPhase: ExecutionPhase;
  /** 生成时间 */
  generatedAt: string;
  /** 门禁结果 */
  result: PostPhaseGateResult;
  /** 建议 */
  recommendations: string[];
  /** 阶段产出物 */
  deliverables: PhaseDeliverable[];
  /** 元数据 */
  metadata: {
    version: string;
    checkerVersion: string;
    rulesExecuted: number;
  };
}

/**
 * 阶段后门禁规则处理器函数类型
 */
export type PostPhaseGateRuleHandler = (
  context: PostPhaseGateContext,
  rule: PostPhaseGateRule
) => Promise<PostPhaseGateCheckResult>;

/**
 * 阶段退出验证结果
 */
export interface PhaseExitValidation {
  /** 是否满足退出条件 */
  canExit: boolean;
  /** 未满足的条件列表 */
  unmetConditions: string[];
  /** 建议操作 */
  suggestedActions: string[];
  /** 是否允许强制退出 */
  allowForceExit: boolean;
  /** 强制退出风险 */
  forceExitRisks?: string[];
}

/**
 * 默认阶段后门禁配置
 */
export const DEFAULT_POST_PHASE_GATE_CONFIG: PostPhaseGateConfig = {
  enabled: true,
  phaseGates: new Map(),
  minQualityScore: 60,
  stopOnFailure: false,
  generateReport: true,
};

/**
 * development 阶段完成后默认规则
 */
export const DEFAULT_DEV_POST_PHASE_RULES: PostPhaseGateRule[] = [
  {
    id: 'dev-completion-check',
    type: 'completion_verification',
    name: '开发完成验证',
    description: '验证开发阶段是否成功完成',
    enabled: true,
    blocking: true,
  },
  {
    id: 'dev-artifact-validation',
    type: 'artifact_validation',
    name: '开发产物验证',
    description: '验证开发产物是否完整',
    enabled: true,
    blocking: true,
  },
  {
    id: 'dev-checkpoint-completion',
    type: 'checkpoint_completion',
    name: '检查点完成度验证',
    description: '验证开发阶段检查点完成情况',
    enabled: true,
    blocking: false,
    config: { minCompletionRate: 0.8 },
  },
  {
    id: 'dev-deliverable-check',
    type: 'deliverable_check',
    name: '开发可交付物检查',
    description: '检查代码变更和测试是否就绪',
    enabled: true,
    blocking: true,
  },
];

/**
 * code_review 阶段完成后默认规则
 */
export const DEFAULT_CR_POST_PHASE_RULES: PostPhaseGateRule[] = [
  {
    id: 'cr-completion-check',
    type: 'completion_verification',
    name: '代码审核完成验证',
    description: '验证代码审核是否成功完成',
    enabled: true,
    blocking: true,
  },
  {
    id: 'cr-review-approval',
    type: 'review_approval',
    name: '代码审核批准验证',
    description: '验证代码审核是否获得批准',
    enabled: true,
    blocking: true,
  },
  {
    id: 'cr-artifact-validation',
    type: 'artifact_validation',
    name: '代码审核产物验证',
    description: '验证代码审核产物是否完整',
    enabled: true,
    blocking: false,
  },
  {
    id: 'cr-quality-score',
    type: 'quality_score',
    name: '代码审核质量分数检查',
    description: '检查代码审核后的质量分数',
    enabled: true,
    blocking: false,
    config: { minScore: 60 },
  },
];

/**
 * qa 阶段完成后默认规则
 */
export const DEFAULT_QA_POST_PHASE_RULES: PostPhaseGateRule[] = [
  {
    id: 'qa-completion-check',
    type: 'completion_verification',
    name: 'QA完成验证',
    description: '验证QA阶段是否成功完成',
    enabled: true,
    blocking: true,
  },
  {
    id: 'qa-test-results',
    type: 'test_results',
    name: 'QA测试结果验证',
    description: '验证QA测试结果是否通过',
    enabled: true,
    blocking: true,
  },
  {
    id: 'qa-review-approval',
    type: 'review_approval',
    name: 'QA审核批准验证',
    description: '验证QA是否获得批准',
    enabled: true,
    blocking: true,
  },
  {
    id: 'qa-deliverable-check',
    type: 'deliverable_check',
    name: 'QA可交付物检查',
    description: '检查QA报告和测试结果',
    enabled: true,
    blocking: false,
  },
];

/**
 * evaluation 阶段完成后默认规则
 */
export const DEFAULT_EVAL_POST_PHASE_RULES: PostPhaseGateRule[] = [
  {
    id: 'eval-completion-check',
    type: 'completion_verification',
    name: '评估完成验证',
    description: '验证评估阶段是否成功完成',
    enabled: true,
    blocking: true,
  },
  {
    id: 'eval-deliverable-check',
    type: 'deliverable_check',
    name: '评估可交付物检查',
    description: '检查最终评估报告',
    enabled: true,
    blocking: true,
  },
  {
    id: 'eval-quality-score',
    type: 'quality_score',
    name: '最终质量分数检查',
    description: '检查最终质量分数是否达标',
    enabled: true,
    blocking: false,
    config: { minScore: 70 },
  },
  {
    id: 'eval-all-phases-check',
    type: 'completion_verification',
    name: '全阶段完成检查',
    description: '验证所有阶段是否已完成',
    enabled: true,
    blocking: true,
  },
];

/**
 * 创建默认阶段后门禁配置
 */
export function createDefaultPostPhaseGateConfig(): PostPhaseGateConfig {
  const phaseGates = new Map<ExecutionPhase, PostPhaseGateConfigEntry>();

  phaseGates.set('development', {
    phase: 'development',
    enabled: true,
    rules: DEFAULT_DEV_POST_PHASE_RULES,
    minQualityScore: 50,
    blocking: true,
    minCheckpointCompletionRate: 0.8,
  });

  phaseGates.set('code_review', {
    phase: 'code_review',
    enabled: true,
    rules: DEFAULT_CR_POST_PHASE_RULES,
    minQualityScore: 60,
    blocking: true,
    minCheckpointCompletionRate: 0.9,
  });

  phaseGates.set('qa', {
    phase: 'qa',
    enabled: true,
    rules: DEFAULT_QA_POST_PHASE_RULES,
    minQualityScore: 70,
    blocking: true,
    minCheckpointCompletionRate: 1.0,
  });

  phaseGates.set('evaluation', {
    phase: 'evaluation',
    enabled: true,
    rules: DEFAULT_EVAL_POST_PHASE_RULES,
    minQualityScore: 70,
    blocking: true,
    minCheckpointCompletionRate: 1.0,
  });

  return {
    enabled: true,
    phaseGates,
    minQualityScore: 60,
    stopOnFailure: false,
    generateReport: true,
  };
}
