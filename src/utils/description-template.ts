/**
 * 结构化描述模板工具
 * 用于生成结构化的任务描述，包含问题分析、解决方案、验收标准等
 */

import { inferCheckpointPrefix } from './validation-rules/checkpoint-rules.js';

/**
 * 描述模板类型
 */
export type DescriptionTemplateType = 'simple' | 'detailed';

/**
 * 结构化描述字段
 */
export interface StructuredDescription {
  /** 问题描述 */
  problem: string;
  /** 根因分析 */
  rootCause?: string;
  /** 解决方案 */
  solution?: string;
  /** 验收检查点 */
  checkpoints: string[];
  /** 相关文件 */
  relatedFiles: string[];
  /** 附加说明 */
  notes?: string;
}

/**
 * 生成简单格式的描述
 */
function generateSimpleDescription(data: StructuredDescription): string {
  const parts: string[] = [];

  parts.push(`## 问题描述\n${data.problem}`);

  if (data.rootCause) {
    parts.push(`\n## 根因分析\n${data.rootCause}`);
  }

  if (data.solution) {
    parts.push(`\n## 解决方案\n${data.solution}`);
  }

  if (data.checkpoints.length > 0) {
    parts.push(`\n## 检查点`);
    data.checkpoints.forEach((cp, idx) => {
      parts.push(`- CP-${idx + 1}: ${cp}`);
    });
  }

  if (data.relatedFiles.length > 0) {
    parts.push(`\n## 相关文件`);
    data.relatedFiles.forEach(f => {
      parts.push(`- ${f}`);
    });
  }

  if (data.notes) {
    parts.push(`\n## 备注\n${data.notes}`);
  }

  return parts.join('\n');
}

/**
 * 生成详细格式的描述
 */
function generateDetailedDescription(data: StructuredDescription): string {
  const parts: string[] = [];

  // 任务描述头部
  parts.push('# 任务描述');

  // 问题描述
  parts.push(`## 问题描述`);
  parts.push(data.problem);
  parts.push('');

  // 根因分析
  if (data.rootCause) {
    parts.push(`## 根因分析`);
    parts.push(data.rootCause);
    parts.push('');
  }

  // 解决方案
  if (data.solution) {
    parts.push(`## 解决方案`);
    parts.push(data.solution);
    parts.push('');
  }

  // 检查点
  if (data.checkpoints.length > 0) {
    parts.push(`## 检查点`);
    data.checkpoints.forEach((cp, idx) => {
      parts.push(`- CP-${idx + 1}: ${cp}`);
    });
    parts.push('');
  }

  // 相关文件
  if (data.relatedFiles.length > 0) {
    parts.push(`## 相关文件`);
    data.relatedFiles.forEach(f => {
      parts.push(`- ${f}`);
    });
    parts.push('');
  }

  // 附加说明
  if (data.notes) {
    parts.push(`## 备注`);
    parts.push(data.notes);
    parts.push('');
  }

  // 验收标准模板
  parts.push(`## 验收标准`);
  parts.push(`请确保满足以下所有标准:`);
  if (data.checkpoints.length > 0) {
    data.checkpoints.forEach((cp, idx) => {
      parts.push(`${idx + 1}. ${cp} 已完成并验证`);
    });
  }
  parts.push(`${data.checkpoints.length + 1}. 代码已通过 lint 检查`);
  parts.push(`${data.checkpoints.length + 2}. 相关测试已通过`);
  parts.push('');

  return parts.join('\n');
}

/**
 * 生成结构化描述
 * @param data 结构化描述数据
 * @param templateType 模板类型
 */
export function generateStructuredDescription(
  data: StructuredDescription,
  templateType: DescriptionTemplateType = 'simple'
): string {
  if (templateType === 'detailed') {
    return generateDetailedDescription(data);
  }
  return generateSimpleDescription(data);
}

/**
 * 从用户输入中提取结构化信息
 * 使用启发式规则识别问题描述、根因分析、解决方案等
 */
export function extractStructuredInfo(input: string): StructuredDescription {
  const lowerInput = input.toLowerCase();

  // 提取问题描述
  const problem = extractProblem(input);

  // 提取根因分析
  const rootCause = extractRootCause(input);

  // 提取解决方案
  const solution = extractSolution(input);

  // 提取检查点
  const checkpoints = extractCheckpoints(input);

  // 提取相关文件
  const relatedFiles = extractRelatedFiles(input);

  // 生成附加说明
  const notes = extractNotes(input);

  return {
    problem,
    rootCause,
    solution,
    checkpoints,
    relatedFiles,
    notes,
  };
}

/**
 * 提取问题描述
 */
function extractProblem(input: string): string {
  // 尝试匹配 "问题描述" 或 "问题:" 等模式
  const problemMatch = input.match(/(?:问题描述|问题|Problem)[:：]\s*([^\n]+(?:\n(?![#一二三四五六七八九十])[^\n]+)*)/i);
  if (problemMatch && problemMatch[1]) {
    return problemMatch[1].trim();
  }

  // 如果没有明确标记，使用第一段作为问题描述
  const firstParagraph = input.split(/\n\n/)[0];
  if (firstParagraph) {
    return firstParagraph.trim();
  }

  return input.trim();
}

/**
 * 提取根因分析
 */
function extractRootCause(input: string): string | undefined {
  // 匹配 "根因分析" 或 "原因" 等模式
  const rootCauseMatch = input.match(/(?:根因分析|根因|原因|Root Cause|Cause)[:：]\s*([^\n]+(?:\n(?![#一二三四五六七八九十])[^\n]+)*)/i);
  if (rootCauseMatch && rootCauseMatch[1]) {
    return rootCauseMatch[1].trim();
  }

  // 检测 "因为"、"由于" 等关键词
  const becauseMatch = input.match(/(?:因为|由于|caused by|because)[:：]?\s*([^\n]+)/i);
  if (becauseMatch && becauseMatch[1]) {
    return becauseMatch[1].trim();
  }

  return undefined;
}

/**
 * 提取解决方案
 */
function extractSolution(input: string): string | undefined {
  // 匹配 "解决方案" 或 "方案" 等模式
  const solutionMatch = input.match(/(?:解决方案|方案|Solution|Approach)[:：]\s*([^\n]+(?:\n(?![#一二三四五六七八九十])[^\n]+)*)/i);
  if (solutionMatch && solutionMatch[1]) {
    return solutionMatch[1].trim();
  }

  // 检测 "建议"、"应该" 等关键词
  const suggestMatch = input.match(/(?:建议|应该|需要|suggest|should|need to)[:：]?\s*([^\n]+)/i);
  if (suggestMatch && suggestMatch[1]) {
    return suggestMatch[1].trim();
  }

  return undefined;
}

/**
 * 提取检查点
 */
function extractCheckpoints(input: string): string[] {
  const checkpoints: string[] = [];

  // 匹配 "检查点" 或 "验收标准" 等模式
  const checkpointMatch = input.match(/(?:检查点|验收标准|Checkpoints|Acceptance Criteria)[:：]\s*([\s\S]*?)(?=\n##|\n#|$)/i);
  if (checkpointMatch && checkpointMatch[1]) {
    const lines = checkpointMatch[1].split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      // 匹配列表项
      const itemMatch = trimmed.match(/[-*]\s*(.+)/);
      if (itemMatch && itemMatch[1]) {
        checkpoints.push(itemMatch[1].trim());
      }
    }
  }

  // 匹配 CP- 前缀的检查点
  const cpMatches = input.matchAll(/CP-\d+[:：]?\s*([^\n]+)/g);
  for (const match of cpMatches) {
    if (match[1] && !checkpoints.includes(match[1].trim())) {
      checkpoints.push(match[1].trim());
    }
  }

  return checkpoints;
}

/**
 * 提取相关文件
 */
function extractRelatedFiles(input: string): string[] {
  const files: string[] = [];

  // 匹配 "相关文件" 模式
  const fileMatch = input.match(/(?:相关文件|Related Files|Files)[:：]\s*([\s\S]*?)(?=\n##|\n#|$)/i);
  if (fileMatch && fileMatch[1]) {
    const lines = fileMatch[1].split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      // 匹配文件路径
      const itemMatch = trimmed.match(/[-*]?\s*(.+)/);
      if (itemMatch && itemMatch[1]) {
        const filePath = itemMatch[1].trim();
        // 简单验证是否像文件路径
        if (/[/.]/.test(filePath) || filePath.endsWith('.ts') || filePath.endsWith('.js') || filePath.endsWith('.py')) {
          files.push(filePath);
        }
      }
    }
  }

  // 自动检测文件路径模式
  const filePathPattern = /\b(?:src\/|lib\/|test\/|tests\/|docs\/)?[\w/-]+\.(ts|js|tsx|jsx|py|go|java|rs|md)\b/g;
  const autoDetected = input.match(filePathPattern);
  if (autoDetected) {
    for (const file of autoDetected) {
      if (!files.includes(file)) {
        files.push(file);
      }
    }
  }

  return files;
}

/**
 * 提取附加说明
 */
function extractNotes(input: string): string | undefined {
  // 匹配 "备注" 或 "说明" 等模式
  const notesMatch = input.match(/(?:备注|说明|注意|Notes|Note|Attention)[:：]\s*([^\n]+(?:\n(?![#一二三四五六七八九十])[^\n]+)*)/i);
  if (notesMatch && notesMatch[1]) {
    return notesMatch[1].trim();
  }

  return undefined;
}

/**
 * 智能检查点生成器
 * 从任务描述中提取具体的可验证条件
 */

/**
 * 检查点实体类型
 */
interface CheckpointEntity {
  type: 'function' | 'file' | 'module' | 'class' | 'variable' | 'api' | 'config';
  name: string;
  action: 'export' | 'import' | 'call' | 'implement' | 'modify' | 'create' | 'remove' | 'refactor';
  context?: string;
}

/**
 * 从解决方案部分提取具体检查点
 */
function extractSolutionCheckpoints(description: string): string[] {
  const checkpoints: string[] = [];

  // 匹配解决方案/方案部分
  const solutionMatch = description.match(/##\s*(?:解决方案|方案|Solution)[^\n]*\n([\s\S]*?)(?=\n##|$)/i);
  if (!solutionMatch) return checkpoints;

  const solution = solutionMatch[1] ?? '';

  // 提取编号步骤 (1. xxx 或 - xxx)
  const stepMatches = solution.matchAll(/(?:^\s*(?:\d+\.|[-*])\s*)([^\n]+)/gm);
  for (const match of stepMatches) {
    const step = (match[1] ?? '').trim();
    // 转换为可验证的检查点
    const checkpoint = convertStepToCheckpoint(step);
    if (checkpoint) {
      checkpoints.push(checkpoint);
    }
  }

  return checkpoints;
}

/**
 * 判断文本是否包含具体可识别的术语
 */
function containsSpecificTerms(text: string): boolean {
  // 包含代码标识符（3+字符的英文词）
  if (/[a-zA-Z_][a-zA-Z0-9_]{2,}/.test(text)) return true;
  // 包含中文代码相关术语
  if (/(?:函数|方法|类|模块|接口|API|配置|文件|变量|组件|服务|插件|命令)/.test(text)) return true;
  // 包含文件路径
  if (/\.{0,2}\/[\w/-]+\.[a-z]+/.test(text)) return true;
  return false;
}

/**
 * 将步骤转换为可验证的检查点
 *
 * 策略：优先保留原始步骤文本（它本身就是可验证条件），
 * 仅在文本过于模糊时通过实体提取重构。
 */
function convertStepToCheckpoint(step: string): string | null {
  if (step.length < 5) return null;

  // 过滤掉泛化的流程阶段（如"需求分析"、"核心功能实现"等）
  if (isGenericCheckpoint(step)) return null;

  // 包含具体术语时直接保留
  if (containsSpecificTerms(step)) return step;

  // 中文步骤通常比英文描述更具可操作性，保留较长的中文步骤
  const chineseChars = step.match(/[\u4e00-\u9fa5]/g);
  if (chineseChars && chineseChars.length >= 3) return step;

  return null;
}

/**
 * 从文本中提取代码实体
 */
function extractEntities(text: string): CheckpointEntity[] {
  const entities: CheckpointEntity[] = [];

  // 匹配函数名 (camelCase 或 snake_case 后跟括号)
  const funcMatches = text.matchAll(/\b([a-z][a-zA-Z0-9]*(?:_[a-z0-9]+)*)\s*\(/g);
  for (const match of funcMatches) {
    if (match[1]) entities.push({ type: 'function', name: match[1], action: 'call' });
  }

  // 匹配函数名后跟中文 "函数" 或 "方法"（不带括号）
  const funcNameMatches = text.matchAll(/\b([a-z][a-zA-Z0-9]*(?:_[a-z0-9]+)*)\s*(?:函数|方法|function)/g);
  for (const match of funcNameMatches) {
    if (match[1]) {
      const name = match[1];
      // 避免重复（如果已经通过括号匹配添加过）
      if (!entities.some(e => e.type === 'function' && e.name === name)) {
        entities.push({ type: 'function', name, action: 'implement' });
      }
    }
  }

  // 匹配文件路径
  const fileMatches = text.matchAll(/\b(src\/[\w/-]+\.[a-z]+|\.{0,2}\/[\w/-]+\.[a-z]+|[\w-]+\.(ts|tsx?|js|jsx?|py|go|java|rs))\b/gi);
  for (const match of fileMatches) {
    if (match[1]) entities.push({ type: 'file', name: match[1], action: 'modify' });
  }

  // 匹配类名 (PascalCase)
  const classMatches = text.matchAll(/\b([A-Z][a-zA-Z0-9]*)\b/g);
  for (const match of classMatches) {
    // 排除常见非类名词
    const commonWords = ['API', 'HTTP', 'JSON', 'XML', 'SQL', 'URL', 'ID', 'UI', 'QA'];
    if (match[1] && !commonWords.includes(match[1])) {
      entities.push({ type: 'class', name: match[1], action: 'implement' });
    }
  }

  // 匹配导出语句
  const exportMatches = text.matchAll(/导出|export\s+(?:function\s+)?(\w+)/gi);
  for (const match of exportMatches) {
    if (match[1]) {
      entities.push({ type: 'function', name: match[1], action: 'export' });
    }
  }

  // 匹配模块名
  const moduleMatches = text.matchAll(/(?:模块|module|mod)\s+[:：]?\s*([a-zA-Z][a-zA-Z0-9_-]*)/gi);
  for (const match of moduleMatches) {
    if (match[1]) entities.push({ type: 'module', name: match[1], action: 'create' });
  }

  return entities;
}

/**
 * 格式化检查点
 */
function formatCheckpoint(entity: CheckpointEntity, originalStep: string): string {
  const actionVerbs: Record<string, string> = {
    export: '导出',
    import: '导入',
    call: '调用',
    implement: '实现',
    modify: '修改',
    create: '创建',
    remove: '移除',
    refactor: '重构',
  };

  const typeNames: Record<string, string> = {
    function: '函数',
    file: '文件',
    module: '模块',
    class: '类',
    variable: '变量',
    api: 'API',
    config: '配置',
  };

  // 尝试从原始步骤中提取更多上下文
  const contextMatch = originalStep.match(/(?:在|from|to)\s+([a-zA-Z0-9_./-]+)/i);
  const context = contextMatch ? contextMatch[1] : undefined;

  // 构建检查点描述
  const parts: string[] = [];

  // 添加实体名称
  if (entity.type === 'function') {
    parts.push(`${entity.name} ${typeNames[entity.type]}`);
  } else if (entity.type === 'file') {
    parts.push(entity.name);
  } else if (entity.type === 'class') {
    parts.push(`${entity.name} ${typeNames[entity.type]}`);
  } else {
    parts.push(`${entity.name} ${typeNames[entity.type]}`);
  }

  // 添加动作
  if (entity.action === 'export') {
    parts.unshift('导出');
  } else if (entity.action === 'call' && context) {
    parts.push(`被 ${context} 调用`);
  } else if (entity.action === 'modify') {
    parts.push('被修改');
  } else if (entity.action === 'create') {
    parts.unshift('创建');
  }

  return parts.join(' ').trim();
}

/**
 * 从问题描述部分提取检查点
 */
function extractProblemCheckpoints(description: string): string[] {
  const checkpoints: string[] = [];

  // 匹配问题描述部分
  const problemMatch = description.match(/(?:##\s*问题描述|##\s*问题|##\s*Problem)\s*\n([\s\S]*?)(?=\n##|$)/i);
  if (!problemMatch) return checkpoints;

  const problem = problemMatch[1] ?? '';

  // 提取错误信息、缺失功能等
  const errorMatches = problem.matchAll(/(?:错误|error|异常|exception)[:：]?\s*([^\n]+)/gi);
  for (const match of errorMatches) {
    if (match[1]) checkpoints.push(`修复错误: ${match[1].trim()}`);
  }

  return checkpoints;
}

/**
 * 从根因分析部分提取检查点
 */
function extractRootCauseCheckpoints(description: string): string[] {
  const checkpoints: string[] = [];

  // 匹配根因分析部分
  const rootCauseMatch = description.match(/(?:##\s*根因分析|##\s*根因|##\s*Root\s*Cause)\s*\n([\s\S]*?)(?=\n##|$)/i);
  if (!rootCauseMatch) return checkpoints;

  const rootCause = rootCauseMatch[1] ?? '';

  // 提取关键原因
  const causeMatches = rootCause.matchAll(/(?:^\s*(?:\d+\.|[-*])\s*)([^\n]+)/gm);
  for (const match of causeMatches) {
    const cause = (match[1] ?? '').trim();
    // 转换为需要解决的检查点
    if (cause.includes('缺少') || cause.includes('missing')) {
      checkpoints.push(`补充: ${cause.replace(/^(?:缺少|missing)[:：]?\s*/i, '')}`);
    } else if (cause.includes('错误') || cause.includes('incorrect')) {
      checkpoints.push(`修正: ${cause.replace(/^(?:错误|incorrect)[:：]?\s*/i, '')}`);
    }
  }

  return checkpoints;
}

/**
 * 从描述中的动作动词模式提取可验证检查点
 * 匹配编号列表和 bullet 列表中包含具体操作的项目
 */
function extractActionBasedCheckpoints(description: string): string[] {
  const checkpoints: string[] = [];

  // 匹配编号列表中的具体动作项
  const numberedItems = description.matchAll(/^\s*\d+\.\s+([^\n]+)/gm);
  for (const match of numberedItems) {
    const item = match[1]?.trim();
    if (item && item.length > 5 && containsSpecificTerms(item)) {
      checkpoints.push(item);
    }
  }

  // 匹配 bullet 列表中的具体动作项
  const bulletItems = description.matchAll(/^\s*[-*]\s+([^\n]+)/gm);
  for (const match of bulletItems) {
    const item = match[1]?.trim();
    if (item && item.length > 5 && containsSpecificTerms(item)) {
      checkpoints.push(item);
    }
  }

  // 匹配"动词 + 具体目标"的模式
  const actionTargetPatterns = [
    /(?:导出|export)\s+(\w+(?:\s*[,/]\s*\w+)*)\s*(?:函数|方法|function)?/gi,
    /(?:调用|call)\s+(\w+(?:\.\w+)*)\s*(?:函数|方法)?/gi,
  ];
  for (const pattern of actionTargetPatterns) {
    const matches = description.matchAll(pattern);
    for (const match of matches) {
      const target = match[1];
      if (target && target.length > 1) {
        const verb = match[0].replace(/\s+/g, ' ').split(' ')[0];
        checkpoints.push(`${target} 已${verb}`);
      }
    }
  }

  return [...new Set(checkpoints)];
}

/**
 * 智能推断任务类型并生成对应的检查点建议
 * 基于任务描述内容生成具体的可验证条件
 */
export function inferCheckpointsFromDescription(
  description: string,
  type: 'bug' | 'feature' | 'research' | 'docs' | 'refactor' | 'test'
): string[] {
  const checkpoints: string[] = [];

  // 1. 从解决方案部分提取具体检查点（优先级最高）
  checkpoints.push(...extractSolutionCheckpoints(description));

  // 2. 从问题描述提取检查点
  checkpoints.push(...extractProblemCheckpoints(description));

  // 3. 从根因分析提取检查点
  checkpoints.push(...extractRootCauseCheckpoints(description));

  // 4. 从动作模式提取检查点
  checkpoints.push(...extractActionBasedCheckpoints(description));

  // 5. 如果有具体检查点，去重并添加前缀后返回
  if (checkpoints.length > 0) {
    const uniqueCheckpoints = [...new Set(checkpoints)];
    return uniqueCheckpoints.map(cp => {
      const prefix = inferCheckpointPrefix(cp);
      // 如果检查点已包含前缀，不再重复添加
      if (cp.trim().toLowerCase().startsWith(prefix.toLowerCase())) {
        return cp;
      }
      return `${prefix} ${cp}`;
    });
  }

  // 6. 回退：基于实体生成可验证的检查点
  const entities = extractEntities(description);
  const fallbackCheckpoints = generateEntityFallbackCheckpoints(entities, type, description);
  return fallbackCheckpoints.map(cp => {
    const prefix = inferCheckpointPrefix(cp);
    // 如果检查点已包含前缀，不再重复添加
    if (cp.trim().toLowerCase().startsWith(prefix.toLowerCase())) {
      return cp;
    }
    return `${prefix} ${cp}`;
  });
}

/**
 * 基于实体生成可验证的回退检查点
 *
 * 核心原则：检查点必须引用描述中的具体实体或动作目标，
 * 绝不生成泛化的流程阶段检查点（如"需求分析"、"核心功能实现"、"代码审查"）。
 */
function generateEntityFallbackCheckpoints(
  entities: CheckpointEntity[],
  type: 'bug' | 'feature' | 'research' | 'docs' | 'refactor' | 'test',
  description: string
): string[] {
  const checkpoints: string[] = [];
  const funcEntities = entities.filter(e => e.type === 'function');
  const classEntities = entities.filter(e => e.type === 'class');
  const fileEntities = entities.filter(e => e.type === 'file');
  const lowerDesc = description.toLowerCase();

  const hasSpecificEntities = funcEntities.length > 0 || classEntities.length > 0 || fileEntities.length > 0;

  if (type === 'bug') {
    if (funcEntities.length > 0) {
      const fn = funcEntities[0]!;
      checkpoints.push(`${fn.name} 函数中的问题已定位并修复`);
      checkpoints.push(`${fn.name} 修复后行为正确`);
    }
    if (fileEntities.length > 0) {
      checkpoints.push(`${fileEntities[0]!.name} 相关测试通过`);
    }
    if (classEntities.length > 0) {
      checkpoints.push(`${classEntities[0]!.name} 不再触发异常`);
    }
  } else if (type === 'feature') {
    for (const func of funcEntities.slice(0, 3)) {
      checkpoints.push(`${func.name} 函数已实现并可调用`);
    }
    for (const cls of classEntities.slice(0, 2)) {
      checkpoints.push(`${cls.name} 类已创建并导出`);
    }
    for (const file of fileEntities.slice(0, 2)) {
      checkpoints.push(`${file.name} 已包含所需修改`);
    }
  } else if (type === 'refactor') {
    if (fileEntities.length > 0) {
      checkpoints.push(`${fileEntities[0]!.name} 重构完成，功能不变`);
    }
    if (funcEntities.length > 0) {
      checkpoints.push(`${funcEntities[0]!.name} 接口保持兼容`);
    }
  } else if (type === 'test') {
    if (funcEntities.length > 0) {
      checkpoints.push(`为 ${funcEntities[0]!.name} 编写的测试通过`);
    }
  }

  // 如果有具体实体，直接返回
  if (checkpoints.length > 0) {
    return checkpoints;
  }

  // 无具体实体时：从描述文本中提取动作目标，绝不使用泛化模板
  return generateDescriptionBasedCheckpoints(description, type);
}

/**
 * 从描述文本中提取动作和目标，生成针对性检查点
 *
 * 策略：
 * 1. 提取 "动词+目标" 模式（如 "实现 ModeRegistry" → "ModeRegistry 已实现"）
 * 2. 提取具体标识符（PascalCase、camelCase、snake_case）
 * 3. 提取文件路径
 * 4. 基于 "主语+动作" 模式提取
 *
 * 绝不生成泛化的流程阶段检查点。
 */
function generateDescriptionBasedCheckpoints(
  description: string,
  type: 'bug' | 'feature' | 'research' | 'docs' | 'refactor' | 'test'
): string[] {
  const checkpoints: string[] = [];

  // 策略 1: 提取 "动词+目标" 模式
  const actionTargetPatterns: [RegExp, (m: RegExpMatchArray) => string][] = [
    // 中文: "实现 XXX", "修复 XXX", "添加 XXX", "导出 XXX", "创建 XXX"
    // 支持复合目标：A/B、A 和 B、A、B
    [/(?:实现|完成|开发|编写|设计)\s+([^\s,，。；;]{2,40})/g, m => `${m[1]} 已实现`],
    [/(?:修复|解决|修正)\s+([^\s,，。；;]{2,40})/g, m => `${m[1]} 已修复`],
    [/(?:添加|增加|新增|引入)\s+([^\s,，。；;]{2,40})/g, m => `${m[1]} 已添加`],
    [/(?:导出|暴露)\s+([^\s,，。；;]{2,40})/g, m => `${m[1]} 已导出`],
    [/(?:创建|建立|新建)\s+([^\s,，。；;]{2,40})/g, m => `${m[1]} 已创建`],
    [/(?:集成|接入|对接)\s+([^\s,，。；;]{2,40})/g, m => `${m[1]} 集成已完成`],
    [/(?:优化|改进|提升)\s+([^\s,，。；;]{2,40})/g, m => `${m[1]} 优化已生效`],
    [/(?:替换|迁移|转换)\s+([^\s,，。；;]{2,40})/g, m => `${m[1]} 替换完成`],
    // 复合目标："导出 A/B 函数" → 分别生成每个目标的检查点
    [/(?:导出|暴露|export)\s+([\w]+(?:\/[\w]+)+)/g, m => {
      // 不生成单个检查点，由下面的拆分逻辑处理
      return `${m[1]} 已导出`;
    }],
    // "X 被 Y 调用/使用" 模式 → 直接生成可验证条件
    [/([a-zA-Z_]\w*)\s*被\s*([\w./-]+)\s*(?:在\s*([\w]+)\s*)?(?:调用|使用|引入)/g, m => {
      const subject = m[1];
      const caller = m[2];
      const context = m[3];
      return context ? `${subject} 被 ${caller} 在 ${context} 调用` : `${subject} 被 ${caller} 调用`;
    }],
    // English: "implement X", "fix X", "add X", "export X", "create X"
    [/(?:implement|build|develop)\s+([a-zA-Z][\w\s]{1,40}?)(?:\s+in|\s+for|\s+to|$)/gi, m => `${(m[1] ?? '').trim()} 已实现`],
    [/(?:fix|resolve|patch)\s+([a-zA-Z][\w\s]{1,40}?)(?:\s+in|\s+for|\s+to|$)/gi, m => `${(m[1] ?? '').trim()} 已修复`],
    [/(?:add|introduce)\s+([a-zA-Z][\w\s]{1,40}?)(?:\s+in|\s+for|\s+to|$)/gi, m => `${(m[1] ?? '').trim()} 已添加`],
    [/(?:export|expose)\s+([a-zA-Z][\w\s]{1,40}?)(?:\s+in|\s+for|\s+to|$)/gi, m => `${(m[1] ?? '').trim()} 已导出`],
  ];

  for (const [pattern, transform] of actionTargetPatterns) {
    const matches = [...description.matchAll(pattern)];
    for (const match of matches.slice(0, 2)) {
      const cp = transform(match);
      if (cp.length > 5 && !isGenericCheckpoint(cp)) {
        checkpoints.push(cp);
      }
    }
  }

  // 策略 2: 提取 PascalCase/camelCase 标识符
  const identifierMatches = description.match(/\b[A-Z][a-zA-Z0-9]{2,}\b/g);
  if (identifierMatches) {
    const uniqueIds = [...new Set(identifierMatches)]
      .filter(id => !isCommonWord(id))
      .slice(0, 3);
    for (const id of uniqueIds) {
      const cp = type === 'bug'
        ? `${id} 相关问题已修复`
        : `${id} 相关功能已实现`;
      checkpoints.push(cp);
    }
  }

  // 策略 3: 提取文件路径
  const fileMatches = description.match(/(?:src|lib|test|tests|config)\/[\w/.-]+\.[a-z]+/g);
  if (fileMatches) {
    const uniqueFiles = [...new Set(fileMatches)].slice(0, 2);
    for (const file of uniqueFiles) {
      checkpoints.push(`${file} 包含所需修改`);
    }
  }

  // 策略 4: "X 被 Y 调用/使用" 模式
  const usageMatches = description.matchAll(/(\w+)\s*(?:被|调用|使用|引入)\s*([^\s,，。；;]{2,30})/g);
  for (const match of usageMatches) {
    checkpoints.push(`${match[1]} 被 ${match[2]} 调用`);
  }

  // 去重并过滤泛化检查点
  const filtered = [...new Set(checkpoints)].filter(cp => !isGenericCheckpoint(cp));

  // 如果仍然没有结果，基于标题关键词生成（最后手段）
  if (filtered.length === 0) {
    filtered.push(...generateTitleKeywordCheckpoints(description, type));
  }

  return filtered.length > 0 ? filtered : [`${description.substring(0, 40).replace(/\n/g, ' ')} 目标已达成`];
}

/**
 * 判断是否为泛化的流程阶段检查点
 */
function isGenericCheckpoint(text: string): boolean {
  const genericPatterns = [
    // 泛化流程阶段
    /^需求分析与?设计$/,
    /^核心功能实现$/,
    /^测试与?验证$/,
    /^代码审查$/,
    /^功能通过验收测试$/,
    /^任务目标已完成$/,
    /^实现结果已验证$/,
    /^核心功能已实现$/,
    /^研究目标已明确$/,
    /^研究结论已输出$/,
    // 泛化 UI 流程（仅在非 UI 任务中出现时才是泛化的）
    /^设计\s*(?:UI|ui|界面)\s*原型$/,
    /^实现\s*(?:UI|ui|界面)\s*组件$/,
    /^添加交互逻辑$/,
    /^响应式适配$/,
    // 泛化测试流程
    /^编写单元测试$/,
    /^编写集成测试$/,
    /^测试覆盖率检查$/,
    /^测试用例编写完成$/,
    /^测试全部通过$/,
    // 文档泛化
    /^文档内容完整$/,
    /^文档审核通过$/,
    // 占位符检查点
    /^检查点\d+[（(].*[)）]$/,
    // 纯流程动词（无具体目标）
    /^(?:完善|优化|改进|调整|梳理|整理|配置|部署)$/,
    // "完成 + 泛化目标" 模式
    /^完成\s*(?:基础|核心|主要|关键|所有|相关)\s*(?:功能|模块|组件|代码|修改|实现)?$/,
  ];
  return genericPatterns.some(p => p.test(text));
}

/**
 * 检查是否为常见英文词（非代码标识符）
 */
function isCommonWord(word: string): boolean {
  const common = new Set([
    'API', 'HTTP', 'JSON', 'XML', 'SQL', 'URL', 'ID', 'UI', 'QA',
    'The', 'This', 'That', 'These', 'Those', 'And', 'But', 'For',
    'Not', 'All', 'Any', 'Has', 'Have', 'Been', 'Will', 'Was',
    'Are', 'Can', 'May', 'Use', 'Using', 'Used', 'Set', 'Get',
    'Add', 'New', 'One', 'Two', 'Run', 'Put', 'Map', 'Key',
  ]);
  return common.has(word);
}

/**
 * 基于标题关键词生成最后手段的检查点
 * 从标题中提取有意义的关键词组合
 */
function generateTitleKeywordCheckpoints(
  description: string,
  type: 'bug' | 'feature' | 'research' | 'docs' | 'refactor' | 'test'
): string[] {
  const checkpoints: string[] = [];
  const lines = description.split('\n').filter(l => l.trim().length > 0);
  const firstLine = lines[0]?.trim() || description;

  // 提取第一个有意义的短语
  const meaningfulPhrase = firstLine
    .replace(/^#+\s*/, '')  // 去掉 markdown 标题
    .replace(/^[-*]\s*/, '')  // 去掉列表标记
    .substring(0, 50)
    .trim();

  if (meaningfulPhrase.length > 5) {
    switch (type) {
      case 'bug':
        checkpoints.push(`${meaningfulPhrase} - 问题已定位`);
        checkpoints.push(`${meaningfulPhrase} - 修复后验证通过`);
        break;
      case 'feature':
        checkpoints.push(`${meaningfulPhrase} - 功能已实现`);
        checkpoints.push(`${meaningfulPhrase} - 可正常使用`);
        break;
      case 'refactor':
        checkpoints.push(`${meaningfulPhrase} - 重构完成，行为不变`);
        break;
      case 'test':
        checkpoints.push(`${meaningfulPhrase} - 测试覆盖完成`);
        break;
      case 'docs':
        checkpoints.push(`${meaningfulPhrase} - 文档已更新`);
        break;
      case 'research':
        checkpoints.push(`${meaningfulPhrase} - 分析完成`);
        break;
    }
  }

  return checkpoints;
}

/**
 * 推断相关文件
 */
export function inferRelatedFiles(
  description: string,
  type: 'bug' | 'feature' | 'research' | 'docs' | 'refactor' | 'test'
): string[] {
  const files: string[] = [];
  const lowerDesc = description.toLowerCase();

  // 基于关键词推断文件
  if (lowerDesc.includes('init-requirement') || lowerDesc.includes('init requirement')) {
    files.push('src/commands/init-requirement.ts');
  }
  if (lowerDesc.includes('task') && (lowerDesc.includes('任务') || lowerDesc.includes('command'))) {
    files.push('src/commands/task.ts');
    files.push('src/types/task.ts');
  }
  if (lowerDesc.includes('plan') && (lowerDesc.includes('计划') || lowerDesc.includes('command'))) {
    files.push('src/commands/plan.ts');
  }
  if (lowerDesc.includes('checkpoint') || lowerDesc.includes('检查点')) {
    files.push('src/utils/checkpoint.ts');
  }
  if (lowerDesc.includes('harness') || lowerDesc.includes('流水线')) {
    files.push('src/utils/hd-assembly-line.ts');
  }

  // 基于类型添加通用文件
  if (type === 'test') {
    files.push('jest.config.js');
  }

  return [...new Set(files)]; // 去重
}
