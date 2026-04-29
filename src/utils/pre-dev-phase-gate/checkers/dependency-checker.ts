/**
 * Dependency Checker - 依赖输出检查器
 * 实现 P8 开发阶段前质量门禁的依赖相关规则
 *
 * 规则覆盖:
 * - R-DEPOUT-001: 依赖任务输出可用性检查
 * - R-DEPOUT-002: 依赖接口定义检查
 * - R-DEPOUT-003: 循环依赖检查
 *
 * @module pre-dev-phase-gate/checkers/dependency
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  PreDevPhaseRule,
  PreDevPhaseCheckContext,
  PreDevPhaseCheckItemResult,
  DependencyOutputCheckResult,
} from '../../../types/pre-dev-phase-gate.js';

/**
 * 依赖检查结果
 */
export interface DependencyCheckResult {
  /** 依赖任务ID */
  dependencyTaskId: string;
  /** 依赖任务状态 */
  dependencyStatus: string;
  /** 输出是否可用 */
  outputsAvailable: boolean;
  /** 输出路径列表 */
  outputPaths: string[];
  /** 接口定义是否可用 */
  interfacesAvailable: boolean;
  /** 缺失的输出 */
  missingOutputs: string[];
}

/**
 * R-DEPOUT-001: 依赖任务输出可用性检查
 * 检查上游依赖任务的输出是否可用
 */
export async function checkDependencyOutputAvailable(
  rule: PreDevPhaseRule,
  context: PreDevPhaseCheckContext
): Promise<PreDevPhaseCheckItemResult> {
  const startTime = Date.now();
  const taskDeps = context.task.dependencies || [];

  // 如果没有依赖，跳过检查
  if (taskDeps.length === 0) {
    return {
      checkId: 'R-DEPOUT-001',
      checkName: '依赖任务输出可用性检查',
      ruleId: rule.id,
      passed: true,
      severity: 'info',
      message: '任务没有依赖，跳过检查',
      details: {
        dependencyCount: 0,
        dependencies: [],
      },
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  const config = rule.config as { outputPathPattern?: string; requiredOutputs?: string[] } | undefined;
  const outputPathPattern = config?.outputPathPattern ?? '.projmnt4claude/outputs/{taskId}/';
  const requiredOutputs = config?.requiredOutputs ?? ['output.json', 'interface.json'];

  const dependencyResults: DependencyCheckResult[] = [];
  const missingOutputsList: string[] = [];

  for (const depId of taskDeps) {
    const outputDir = outputPathPattern.replace('{taskId}', depId);
    const outputFullPath = path.join(context.cwd, outputDir);

    // 检查输出目录是否存在
    const dirExists = fs.existsSync(outputFullPath);

    // 检查必需输出文件
    const foundOutputs: string[] = [];
    const missingForDep: string[] = [];

    if (dirExists) {
      for (const output of requiredOutputs) {
        const outputFile = path.join(outputFullPath, output);
        if (fs.existsSync(outputFile)) {
          foundOutputs.push(output);
        } else {
          missingForDep.push(output);
          missingOutputsList.push(`${depId}/${output}`);
        }
      }
    } else {
      missingForDep.push(...requiredOutputs);
      missingOutputsList.push(...requiredOutputs.map(o => `${depId}/${o}`));
    }

    dependencyResults.push({
      dependencyTaskId: depId,
      dependencyStatus: dirExists ? 'completed' : 'pending',
      outputsAvailable: foundOutputs.length === requiredOutputs.length,
      outputPaths: foundOutputs.map(o => path.join(outputDir, o)),
      interfacesAvailable: foundOutputs.includes('interface.json'),
      missingOutputs: missingForDep,
    });
  }

  const allOutputsAvailable = dependencyResults.every(r => r.outputsAvailable);
  const passed = allOutputsAvailable;

  return {
    checkId: 'R-DEPOUT-001',
    checkName: '依赖任务输出可用性检查',
    ruleId: rule.id,
    passed,
    severity: rule.severity,
    message: passed
      ? `所有 ${taskDeps.length} 个依赖任务的输出已就绪`
      : `发现 ${missingOutputsList.length} 个缺失的依赖输出`,
    details: {
      dependencyCount: taskDeps.length,
      dependencies: dependencyResults,
      missingOutputs: missingOutputsList,
      outputPathPattern,
      requiredOutputs,
    } as unknown as Record<string, unknown>,
    suggestions: !passed
      ? [
          '等待依赖任务完成并生成输出',
          ...missingOutputsList.map(mo => `  - 缺失: ${mo}`),
          '或检查依赖输出路径配置',
        ]
      : undefined,
    duration: Date.now() - startTime,
    timestamp: new Date().toISOString(),
  };
}

/**
 * R-DEPOUT-002: 依赖接口定义检查
 * 检查依赖任务的接口定义是否完整
 */
export async function checkDependencyInterface(
  rule: PreDevPhaseRule,
  context: PreDevPhaseCheckContext
): Promise<PreDevPhaseCheckItemResult> {
  const startTime = Date.now();
  const taskDeps = context.task.dependencies || [];

  if (taskDeps.length === 0) {
    return {
      checkId: 'R-DEPOUT-002',
      checkName: '依赖接口定义检查',
      ruleId: rule.id,
      passed: true,
      severity: 'info',
      message: '任务没有依赖，跳过检查',
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  const config = rule.config as { interfaceFileName?: string; requiredFields?: string[] } | undefined;
  const interfaceFileName = config?.interfaceFileName ?? 'interface.json';
  const requiredFields = config?.requiredFields ?? ['exports', 'version'];

  const interfaceResults: Array<{
    dependencyId: string;
    interfaceExists: boolean;
    valid: boolean;
    missingFields: string[];
    errors: string[];
  }> = [];

  let allInterfacesValid = true;

  for (const depId of taskDeps) {
    const interfacePath = path.join(context.cwd, '.projmnt4claude/outputs', depId, interfaceFileName);
    const interfaceExists = fs.existsSync(interfacePath);

    let valid = false;
    const missingFields: string[] = [];
    const errors: string[] = [];

    if (interfaceExists) {
      try {
        const content = fs.readFileSync(interfacePath, 'utf-8');
        const interfaceData = JSON.parse(content) as Record<string, unknown>;

        // 检查必需字段
        for (const field of requiredFields) {
          if (!(field in interfaceData)) {
            missingFields.push(field);
          }
        }

        valid = missingFields.length === 0;
        if (!valid) {
          allInterfacesValid = false;
        }
      } catch (error) {
        valid = false;
        allInterfacesValid = false;
        errors.push(`解析失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      allInterfacesValid = false;
      missingFields.push(...requiredFields);
      errors.push(`接口文件不存在: ${interfacePath}`);
    }

    interfaceResults.push({
      dependencyId: depId,
      interfaceExists,
      valid,
      missingFields,
      errors,
    });
  }

  const passed = allInterfacesValid;
  const invalidCount = interfaceResults.filter(r => !r.valid).length;

  return {
    checkId: 'R-DEPOUT-002',
    checkName: '依赖接口定义检查',
    ruleId: rule.id,
    passed,
    severity: rule.severity,
    message: passed
      ? `所有 ${taskDeps.length} 个依赖的接口定义完整`
      : `发现 ${invalidCount} 个依赖的接口定义不完整`,
    details: {
      dependencyCount: taskDeps.length,
      interfaceFileName,
      requiredFields,
      results: interfaceResults,
    } as unknown as Record<string, unknown>,
    suggestions: !passed
      ? [
          '确保依赖任务生成有效的接口定义文件',
          `接口文件应包含字段: ${requiredFields.join(', ')}`,
          ...interfaceResults
            .filter(r => !r.valid)
            .flatMap(r => [`${r.dependencyId}:`, ...r.errors.map(e => `  - ${e}`)]),
        ]
      : undefined,
    duration: Date.now() - startTime,
    timestamp: new Date().toISOString(),
  };
}

/**
 * R-DEPOUT-003: 循环依赖检查
 * 检查是否存在循环依赖
 */
export async function checkCircularDependency(
  rule: PreDevPhaseRule,
  context: PreDevPhaseCheckContext
): Promise<PreDevPhaseCheckItemResult> {
  const startTime = Date.now();
  const taskId = context.taskId;
  const directDeps = context.task.dependencies || [];

  if (directDeps.length === 0) {
    return {
      checkId: 'R-DEPOUT-003',
      checkName: '循环依赖检查',
      ruleId: rule.id,
      passed: true,
      severity: 'info',
      message: '任务没有依赖，不存在循环依赖',
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  // 检查直接循环（A依赖B，B依赖A）
  const directCycles: string[][] = [];
  const tasksDir = path.join(context.cwd, '.projmnt4claude/tasks');

  for (const depId of directDeps) {
    const depMetaPath = path.join(tasksDir, depId, 'meta.json');
    if (fs.existsSync(depMetaPath)) {
      try {
        const content = fs.readFileSync(depMetaPath, 'utf-8');
        const depMeta = JSON.parse(content) as { dependencies?: string[] };

        if (depMeta.dependencies?.includes(taskId)) {
          directCycles.push([taskId, depId]);
        }
      } catch {
        // 忽略解析错误
      }
    }
  }

  // 检查间接循环（通过深度优先搜索）
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const indirectCycles: string[][] = [];

  function hasCycle(currentTaskId: string, pathStack: string[], deps: string[]): boolean {
    visited.add(currentTaskId);
    recursionStack.add(currentTaskId);

    for (const depId of deps) {
      // 检查 depId 是否依赖当前任务（形成循环）
      if (depId === taskId) {
        const cycleStart = pathStack.indexOf(taskId);
        if (cycleStart !== -1) {
          indirectCycles.push([...pathStack.slice(cycleStart), taskId]);
        }
        recursionStack.delete(currentTaskId);
        return true;
      }

      if (!visited.has(depId)) {
        // 读取依赖任务的依赖
        const depMetaPath = path.join(tasksDir, depId, 'meta.json');
        let subDeps: string[] = [];
        if (fs.existsSync(depMetaPath)) {
          try {
            const content = fs.readFileSync(depMetaPath, 'utf-8');
            const depMeta = JSON.parse(content) as { dependencies?: string[] };
            subDeps = depMeta.dependencies || [];
          } catch {
            // 忽略解析错误
          }
        }

        if (hasCycle(depId, [...pathStack, depId], subDeps)) {
          return true;
        }
      } else if (recursionStack.has(depId)) {
        // 发现循环
        const cycleStart = pathStack.indexOf(depId);
        if (cycleStart !== -1) {
          indirectCycles.push([...pathStack.slice(cycleStart), depId]);
        }
        recursionStack.delete(currentTaskId);
        return true;
      }
    }

    recursionStack.delete(currentTaskId);
    return false;
  }

  // 从每个直接依赖开始检查
  for (const depId of directDeps) {
    if (!visited.has(depId)) {
      // 读取依赖任务的依赖
      const depMetaPath = path.join(tasksDir, depId, 'meta.json');
      let subDeps: string[] = [];
      if (fs.existsSync(depMetaPath)) {
        try {
          const content = fs.readFileSync(depMetaPath, 'utf-8');
          const depMeta = JSON.parse(content) as { dependencies?: string[] };
          subDeps = depMeta.dependencies || [];
        } catch {
          // 忽略解析错误
        }
      }

      hasCycle(depId, [taskId, depId], subDeps);
    }
  }

  const allCycles = [...directCycles, ...indirectCycles];
  const hasAnyCycle = allCycles.length > 0;

  return {
    checkId: 'R-DEPOUT-003',
    checkName: '循环依赖检查',
    ruleId: rule.id,
    passed: !hasAnyCycle,
    severity: 'error',
    message: hasAnyCycle
      ? `发现 ${allCycles.length} 个循环依赖`
      : '未发现循环依赖',
    details: {
      directDependencyCount: directDeps.length,
      directCycles: directCycles.length,
      indirectCycles: indirectCycles.length,
      cycles: allCycles.map(cycle => cycle.join(' -> ')),
    } as unknown as Record<string, unknown>,
    suggestions: hasAnyCycle
      ? [
          '检测到以下循环依赖:',
          ...allCycles.map(cycle => `  ${cycle.join(' -> ')}`),
          '',
          '建议解决方案:',
          '  1. 重新设计任务依赖关系',
          '  2. 将循环依赖的任务合并',
          '  3. 提取公共逻辑为独立任务',
        ]
      : undefined,
    duration: Date.now() - startTime,
    timestamp: new Date().toISOString(),
  };
}
