/**
 * 计划相关 AI 输出验证规则集
 *
 * 为 inferSemanticDependencies 等 AI 调用方法提供结构化输出验证，
 * 确保返回的 JSON 包含合法的依赖关系字段。
 *
 * 规则作用于原始字符串输出（JSON），在 FeedbackConstraintEngine 的
 * jsonParseableRule / nonEmptyOutputRule 之上叠加业务字段校验。
 *
 * 阻断性质量门禁规则 (QG-PLAN-003):
 * - plan-cycle-detection: 检测循环依赖
 * - plan-invalid-dependency: 检测无效依赖
 * - plan-orphan-subtask: 检测孤儿子任务
 */

import type {
  ValidationRule,
  ValidationViolation,
} from '../../types/feedback-constraint.js';
import type { TaskMeta } from '../../types/task.js';

// ============================================================
// 辅助函数
// ============================================================

/**
 * 安全解析 JSON 字符串
 * 返回 null 表示非 JSON 或解析失败（由 jsonParseableRule 处理）
 */
function safeParseJson(output: unknown): Record<string, unknown> | null {
  if (typeof output !== 'string') return null;
  try {
    let text = output.trim();
    // 去除 markdown 代码块包裹
    const match = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
    if (match) text = match[1]!.trim();
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ============================================================
// inferSemanticDependencies 输出规则
// ============================================================

/**
 * 语义依赖输出必须包含 dependencies 数组字段
 */
export const semanticDepsRequiredFields: ValidationRule = {
  id: 'semantic-deps-required-fields',
  description: '语义依赖输出必须包含 dependencies 数组字段',
  severity: 'error',
  check: (output: unknown): ValidationViolation | null => {
    const parsed = safeParseJson(output);
    if (!parsed) return null; // JSON 解析失败由 jsonParseableRule 处理
    if (!('dependencies' in parsed)) {
      return {
        ruleId: 'semantic-deps-required-fields',
        severity: 'error',
        message: '语义依赖输出缺少 dependencies 字段',
      };
    }
    return null;
  },
};

/**
 * dependencies 必须是数组类型
 */
export const semanticDepsArrayType: ValidationRule = {
  id: 'semantic-deps-array-type',
  description: 'dependencies 必须是数组类型',
  severity: 'warning',
  check: (output: unknown): ValidationViolation | null => {
    const parsed = safeParseJson(output);
    if (!parsed || !('dependencies' in parsed)) return null;
    if (!Array.isArray(parsed.dependencies)) {
      return {
        ruleId: 'semantic-deps-array-type',
        severity: 'warning',
        message: `dependencies 不是数组类型，实际类型: ${typeof parsed.dependencies}`,
        value: String(parsed.dependencies),
      };
    }
    return null;
  },
};

/**
 * dependencies 中每个元素必须包含 taskId, depTaskId, reason 字段且均为字符串
 */
export const semanticDepsItemStructure: ValidationRule = {
  id: 'semantic-deps-item-structure',
  description: 'dependencies 中每个元素必须包含 taskId, depTaskId, reason 字段且均为字符串',
  severity: 'warning',
  check: (output: unknown): ValidationViolation | null => {
    const parsed = safeParseJson(output);
    if (!parsed || !('dependencies' in parsed) || !Array.isArray(parsed.dependencies)) return null;
    for (let i = 0; i < parsed.dependencies.length; i++) {
      const item = parsed.dependencies[i] as Record<string, unknown>;
      if (!item || typeof item !== 'object') {
        return {
          ruleId: 'semantic-deps-item-structure',
          severity: 'warning',
          message: `dependencies[${i}] 不是对象类型`,
          value: String(item),
        };
      }
      const missing = ['taskId', 'depTaskId', 'reason'].filter(f => !(f in item));
      if (missing.length > 0) {
        return {
          ruleId: 'semantic-deps-item-structure',
          severity: 'warning',
          message: `dependencies[${i}] 缺少必需字段: ${missing.join(', ')}`,
        };
      }
      for (const field of ['taskId', 'depTaskId', 'reason'] as const) {
        if (typeof item[field] !== 'string') {
          return {
            ruleId: 'semantic-deps-item-structure',
            severity: 'warning',
            message: `dependencies[${i}].${field} 不是字符串类型，实际类型: ${typeof item[field]}`,
            field,
            value: String(item[field]),
          };
        }
      }
    }
    return null;
  },
};

/**
 * taskId 与 depTaskId 不应相同（自依赖检查）
 */
export const semanticDepsNoSelfRef: ValidationRule = {
  id: 'semantic-deps-no-self-ref',
  description: 'dependencies 中 taskId 与 depTaskId 不应相同',
  severity: 'warning',
  check: (output: unknown): ValidationViolation | null => {
    const parsed = safeParseJson(output);
    if (!parsed || !('dependencies' in parsed) || !Array.isArray(parsed.dependencies)) return null;
    for (let i = 0; i < parsed.dependencies.length; i++) {
      const item = parsed.dependencies[i] as Record<string, unknown>;
      if (!item || typeof item !== 'object') continue;
      if (item.taskId === item.depTaskId && typeof item.taskId === 'string') {
        return {
          ruleId: 'semantic-deps-no-self-ref',
          severity: 'warning',
          message: `dependencies[${i}] 存在自依赖: taskId="${item.taskId}"`,
          value: String(item.taskId),
        };
      }
    }
    return null;
  },
};

/**
 * 依赖数量超过 8 条时触发 warning
 */
export const semanticDepsCountControl: ValidationRule = {
  id: 'semantic-deps-count-control',
  description: '依赖数量超过 8 条时触发 warning',
  severity: 'warning',
  check: (output: unknown): ValidationViolation | null => {
    const parsed = safeParseJson(output);
    if (!parsed || !('dependencies' in parsed) || !Array.isArray(parsed.dependencies)) return null;
    const count = parsed.dependencies.length;
    if (count > 8) {
      return {
        ruleId: 'semantic-deps-count-control',
        severity: 'warning',
        message: `依赖数量 ${count} 条，超过 8 条建议上限`,
        value: String(count),
      };
    }
    return null;
  },
};

/**
 * 每条依赖的 reason 最少 10 个字符，否则触发 error
 */
export const semanticDepsReasonMinLength: ValidationRule = {
  id: 'semantic-deps-reason-min-length',
  description: '每条依赖的 reason 最少 10 个字符',
  severity: 'error',
  check: (output: unknown): ValidationViolation | null => {
    const parsed = safeParseJson(output);
    if (!parsed || !('dependencies' in parsed) || !Array.isArray(parsed.dependencies)) return null;
    for (let i = 0; i < parsed.dependencies.length; i++) {
      const item = parsed.dependencies[i] as Record<string, unknown>;
      if (!item || typeof item !== 'object') continue;
      if (typeof item.reason === 'string' && item.reason.trim().length < 10) {
        return {
          ruleId: 'semantic-deps-reason-min-length',
          severity: 'error',
          message: `dependencies[${i}].reason 长度 ${item.reason.trim().length} 不足 10 字符`,
          field: 'reason',
          value: item.reason,
        };
      }
    }
    return null;
  },
};

// ============================================================
// 按方法分组的规则集
// ============================================================

/** inferSemanticDependencies 方法验证规则 */
export const semanticDependencyOutputRules: ValidationRule[] = [
  semanticDepsRequiredFields,
  semanticDepsArrayType,
  semanticDepsItemStructure,
  semanticDepsNoSelfRef,
  semanticDepsCountControl,
  semanticDepsReasonMinLength,
];

// ============================================================
// 阻断性质量门禁规则 (QG-PLAN-003)
// ============================================================

/**
 * 构建任务依赖图并检测循环
 * 使用 DFS 算法检测有向图中的环
 */
function detectTaskCycles(tasks: TaskMeta[]): { hasCycle: boolean; cycles: string[][]; taskId: string } {
  const adjacency = new Map<string, Set<string>>();

  // 构建邻接表
  for (const task of tasks) {
    if (!adjacency.has(task.id)) {
      adjacency.set(task.id, new Set());
    }
    for (const depId of task.dependencies) {
      adjacency.get(task.id)!.add(depId);
    }
  }

  const cycles: string[][] = [];
  const visited = new Set<string>();
  const onStack = new Set<string>();
  const path: string[] = [];

  function dfs(node: string): void {
    if (onStack.has(node)) {
      // 发现环
      const cycleStart = path.indexOf(node);
      if (cycleStart !== -1) {
        cycles.push([...path.slice(cycleStart), node]);
      }
      return;
    }
    if (visited.has(node)) return;

    visited.add(node);
    onStack.add(node);
    path.push(node);

    const neighbors = adjacency.get(node);
    if (neighbors) {
      for (const neighbor of neighbors) {
        dfs(neighbor);
      }
    }

    path.pop();
    onStack.delete(node);
  }

  for (const taskId of adjacency.keys()) {
    if (!visited.has(taskId)) {
      dfs(taskId);
    }
  }

  return {
    hasCycle: cycles.length > 0,
    cycles,
    taskId: cycles.length > 0 ? cycles[0]![0]! : '',
  };
}

/**
 * CP-1: plan-cycle-detection 规则实现（检测循环依赖）
 * 检测任务依赖关系中是否存在循环
 */
export const planCycleDetection: ValidationRule = {
  id: 'plan-cycle-detection',
  description: '检测任务依赖关系中是否存在循环依赖',
  severity: 'error',
  check: (task: unknown, context?: { allTasks?: TaskMeta[] }): ValidationViolation | null => {
    const t = task as TaskMeta;
    const allTasks = context?.allTasks;

    if (!allTasks || allTasks.length === 0) {
      return null;
    }

    const result = detectTaskCycles(allTasks);

    if (result.hasCycle) {
      const cycleStr = result.cycles.map(c => c.join(' → ')).join('; ');
      return {
        ruleId: 'plan-cycle-detection',
        severity: 'error',
        message: `检测到循环依赖: ${cycleStr}。请检查任务依赖关系，移除循环引用`,
      };
    }

    return null;
  },
};

/**
 * CP-2: plan-invalid-dependency 规则实现（检测无效依赖）
 * 检测任务依赖是否引用不存在的任务
 */
export const planInvalidDependency: ValidationRule = {
  id: 'plan-invalid-dependency',
  description: '检测任务依赖是否引用不存在的任务',
  severity: 'error',
  check: (task: unknown, context?: { allTasks?: TaskMeta[] }): ValidationViolation | null => {
    const t = task as TaskMeta;
    const allTasks = context?.allTasks;

    if (!allTasks || allTasks.length === 0) {
      return null;
    }

    const validTaskIds = new Set(allTasks.map(task => task.id));
    const invalidDeps: string[] = [];

    for (const depId of t.dependencies) {
      if (!validTaskIds.has(depId)) {
        invalidDeps.push(depId);
      }
    }

    if (invalidDeps.length > 0) {
      return {
        ruleId: 'plan-invalid-dependency',
        severity: 'error',
        message: `任务 ${t.id} 包含无效依赖: ${invalidDeps.join(', ')}。这些任务ID不存在`,
      };
    }

    return null;
  },
};

/**
 * CP-3: plan-orphan-subtask 规则实现（检测孤儿子任务）
 * 检测有 parentId 但父任务不存在的子任务
 */
export const planOrphanSubtask: ValidationRule = {
  id: 'plan-orphan-subtask',
  description: '检测有 parentId 但父任务不存在的孤儿子任务',
  severity: 'error',
  check: (task: unknown, context?: { allTasks?: TaskMeta[] }): ValidationViolation | null => {
    const t = task as TaskMeta;
    const allTasks = context?.allTasks;

    if (!allTasks || allTasks.length === 0) {
      return null;
    }

    // 检查是否有 parentId
    if (!t.parentId) {
      return null;
    }

    const validTaskIds = new Set(allTasks.map(task => task.id));

    // 检查父任务是否存在
    if (!validTaskIds.has(t.parentId)) {
      return {
        ruleId: 'plan-orphan-subtask',
        severity: 'error',
        message: `任务 ${t.id} 声明了父任务 ${t.parentId}，但该父任务不存在。请检查 parentId 或创建父任务`,
      };
    }

    return null;
  },
};

// ============================================================
// 警告性质量门禁规则 (QG-PLAN-004)
// ============================================================

/**
 * CP-1: plan-orphan-task 规则实现（孤立任务检测）
 * 检测没有依赖且不被其他任务依赖的任务（可能的孤立任务）
 */
export const planOrphanTask: ValidationRule = {
  id: 'plan-orphan-task',
  description: '检测孤立任务（无依赖且不被依赖的任务）',
  severity: 'warning',
  check: (task: unknown, context?: { allTasks?: TaskMeta[] }): ValidationViolation | null => {
    const t = task as TaskMeta;
    const allTasks = context?.allTasks;

    if (!allTasks || allTasks.length === 0) {
      return null;
    }

    // 有依赖或子任务的不可能是孤立任务
    if (t.dependencies.length > 0 || (t.subtaskIds && t.subtaskIds.length > 0)) {
      return null;
    }

    // 检查是否有其他任务依赖此任务
    const isDependedOn = allTasks.some(otherTask =>
      otherTask.dependencies.includes(t.id)
    );

    // 不是任何任务的依赖，且没有自己的依赖 -> 孤立任务
    if (!isDependedOn) {
      return {
        ruleId: 'plan-orphan-task',
        severity: 'warning',
        message: `任务 ${t.id} 是孤立任务：没有依赖且不被其他任务依赖。建议检查是否遗漏依赖关系或删除无用任务`,
      };
    }

    return null;
  },
};

/**
 * CP-2: plan-blocked-task 规则实现（被阻塞任务检测）
 * 检测所有依赖都未完成的任务
 */
export const planBlockedTask: ValidationRule = {
  id: 'plan-blocked-task',
  description: '检测被阻塞的任务（所有依赖都未完成）',
  severity: 'warning',
  check: (task: unknown, context?: { allTasks?: TaskMeta[] }): ValidationViolation | null => {
    const t = task as TaskMeta;
    const allTasks = context?.allTasks;

    if (!allTasks || allTasks.length === 0) {
      return null;
    }

    // 没有依赖则不可能被阻塞
    if (t.dependencies.length === 0) {
      return null;
    }

    // 任务已完成则不再被阻塞
    if (t.status === 'resolved' || t.status === 'closed') {
      return null;
    }

    // 检查依赖任务的完成情况
    const incompleteDeps: string[] = [];
    for (const depId of t.dependencies) {
      const depTask = allTasks.find(task => task.id === depId);
      if (depTask) {
        const isCompleted = depTask.status === 'resolved' || depTask.status === 'closed';
        if (!isCompleted) {
          incompleteDeps.push(depId);
        }
      }
    }

    // 所有依赖都未完成 -> 被阻塞
    if (incompleteDeps.length === t.dependencies.length) {
      return {
        ruleId: 'plan-blocked-task',
        severity: 'warning',
        message: `任务 ${t.id} 被阻塞：所有 ${t.dependencies.length} 个依赖任务都未完成。建议优先处理依赖任务：${incompleteDeps.join(', ')}`,
      };
    }

    return null;
  },
};

/**
 * CP-3: plan-bridge-node 规则实现（桥接节点检测）
 * 检测作为多个任务桥梁但自身没有实质工作的任务
 */
export const planBridgeNode: ValidationRule = {
  id: 'plan-bridge-node',
  description: '检测桥接节点任务（作为依赖桥梁但缺少检查点）',
  severity: 'warning',
  check: (task: unknown, context?: { allTasks?: TaskMeta[] }): ValidationViolation | null => {
    const t = task as TaskMeta;
    const allTasks = context?.allTasks;

    if (!allTasks || allTasks.length === 0) {
      return null;
    }

    // 统计有多少任务依赖此任务
    const dependentTasks = allTasks.filter(otherTask =>
      otherTask.dependencies.includes(t.id)
    );

    // 桥接节点特征：被多个任务依赖（>=2）且有依赖，但缺少检查点
    const hasManyDependents = dependentTasks.length >= 2;
    const hasDependencies = t.dependencies.length > 0;
    const hasMinimalCheckpoints = !t.checkpoints || t.checkpoints.length <= 1;

    if (hasManyDependents && hasDependencies && hasMinimalCheckpoints) {
      return {
        ruleId: 'plan-bridge-node',
        severity: 'warning',
        message: `任务 ${t.id} 可能是桥接节点：被 ${dependentTasks.length} 个任务依赖且有 ${t.dependencies.length} 个依赖，但检查点过少（${t.checkpoints?.length || 0} 个）。建议添加更多检查点确保质量`,
      } as unknown as ValidationViolation;
    }

    return null;
  },
};

/**
 * CP-4: plan-inferred-only-dependency 规则实现（仅推断依赖检测）
 * 检测只有推断依赖的任务（所有依赖都是通过 AI 推断而非显式声明）
 */
export const planInferredOnlyDependency: ValidationRule = {
  id: 'plan-inferred-only-dependency',
  description: '检测只有推断依赖的任务（建议显式声明关键依赖）',
  severity: 'warning',
  check: (task: unknown, context?: { allTasks?: TaskMeta[]; hasExplicitDeps?: boolean }): ValidationViolation | null => {
    const t = task as TaskMeta;

    // 没有依赖的任务不适用
    if (t.dependencies.length === 0) {
      return null;
    }

    // 检查是否有显式声明的依赖
    // 通过 context 传递是否有显式依赖的信息
    const hasExplicitDeps = context?.hasExplicitDeps;

    // 如果有显式依赖则不触发警告
    if (hasExplicitDeps !== false) {
      return null;
    }

    return {
      ruleId: 'plan-inferred-only-dependency',
      severity: 'warning',
      message: `任务 ${t.id} 只有推断依赖（${t.dependencies.length} 个），没有显式声明的依赖。建议显式声明关键依赖以提高可维护性`,
    };
  },
};

/** 阻断性质量门禁规则集合 */
export const blockingQualityGateRules: ValidationRule[] = [
  planCycleDetection,
  planInvalidDependency,
  planOrphanSubtask,
];

/** 警告性质量门禁规则集合 (QG-PLAN-004) */
export const warningQualityGateRules: ValidationRule[] = [
  planOrphanTask,
  planBlockedTask,
  planBridgeNode,
  planInferredOnlyDependency,
];
