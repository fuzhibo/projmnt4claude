/**
 * 检查点工具函数
 * 用于检查点 ID 生成、解析、同步等操作
 */

import * as fs from 'fs';
import * as path from 'path';
import { getTasksDir } from './path';
import { readTaskMeta, writeTaskMeta } from './task';
import type { TaskMeta, CheckpointMetadata, CheckpointVerification, VerificationMethod } from '../types/task';
import { inferCheckpointAttributesFromPrefix } from './validation-rules/checkpoint-rules';

/**
 * 低质量检查点过滤结果
 */
export interface FilterResult {
  /** 过滤后保留的检查点列表 */
  kept: string[];
  /** 被移除的检查点列表 */
  removed: string[];
  /** 被移除检查点的原因映射 */
  reasons: Map<string, string>;
}

/**
 * 过滤低质量检查点（AI 解析伪影）
 *
 * 三种过滤规则：
 * 1. 单字母类要求：如 "O 类"、"O(n^2) 类" 等 Big-O 记号被误解析为类结构要求
 * 2. 算法名称类要求：如 "DFS类"、"BFS类"、"AST类" 等算法术语被误解析为类定义要求
 * 3. 带 CP-N: 前缀的重复检查点：AI 生成时重复添加了编号前缀
 */
export function filterLowQualityCheckpoints(checkpoints: string[]): FilterResult {
  const kept: string[] = [];
  const removed: string[] = [];
  const reasons = new Map<string, string>();

  // 规则1: 单字母类要求 (Big-O 记号误解析)
  const singleLetterClassPattern = /^[A-Z]\s*类/;

  // 规则2: 算法名称类要求
  const algorithmNamePatterns = [
    /^(DFS|BFS|AST|DAG|DP|KMP|RBM|LRU|LFU|AC自动机)\s*类/i,
    /^(深度优先|广度优先|拓扑排序|动态规划|贪心|回溯|分治|哈希|双指针|滑动窗口|二分|递归)\s*类/,
    /^O\s*[\(（]/,  // O(n^2), O(n) 等复杂度记号
  ];

  // 规则3: CP-N: 前缀的重复检查点
  const cpPrefixPattern = /^CP-\d+:\s*/;

  for (const cp of checkpoints) {
    const trimmed = cp.trim();

    // 检查规则1: 单字母类要求
    if (singleLetterClassPattern.test(trimmed)) {
      removed.push(cp);
      reasons.set(cp, '单字母类要求（疑似 Big-O 记号伪影）');
      continue;
    }

    // 检查规则2: 算法名称类要求
    const matchedAlgorithm = algorithmNamePatterns.some(p => p.test(trimmed));
    if (matchedAlgorithm) {
      removed.push(cp);
      reasons.set(cp, '算法名称类要求（疑似算法术语伪影）');
      continue;
    }

    // 检查规则3: CP-N: 前缀重复检查点（去掉前缀后检查是否与已有检查点重复）
    const cpPrefixMatch = trimmed.match(cpPrefixPattern);
    if (cpPrefixMatch) {
      const stripped = trimmed.replace(cpPrefixPattern, '').trim();
      // 检查去掉前缀后是否与已有检查点重复
      const isDuplicate = kept.some(existing => existing.trim() === stripped) ||
        checkpoints.some(other => other !== cp && other.trim() === stripped);
      if (isDuplicate) {
        removed.push(cp);
        reasons.set(cp, '带 CP-N: 前缀的重复检查点');
        continue;
      }
    }

    kept.push(cp);
  }

  return { kept, removed, reasons };
}

/**
 * 解析后的检查点信息
 */
export interface ParsedCheckpoint {
  id: string;
  text: string;
  checked: boolean;
  lineIndex: number;  // 在文件中的行号
}

/**
 * 生成检查点ID
 * 优先使用描述关键词生成可读ID，回退到序号格式
 */
export function generateCheckpointId(taskId: string, index: number, description: string): string {
  // 从描述中提取关键词生成 slug
  const slug = description
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-') // 保留中文、英文、数字
    .replace(/^-+|-+$/g, '')
    .substring(0, 30);

  // 如果 slug 有效且长度足够，使用描述性 ID
  if (slug && slug.length > 3) {
    return `CP-${slug}`;
  }

  // 回退到序号格式
  return `CP-${String(index + 1).padStart(3, '0')}`;
}

/**
 * 解析 checkpoint.md 文件并分配 ID
 */
export function parseCheckpointsWithIds(taskId: string, cwd: string = process.cwd()): ParsedCheckpoint[] {
  const checkpointPath = path.join(getTasksDir(cwd), taskId, 'checkpoint.md');

  if (!fs.existsSync(checkpointPath)) {
    return [];
  }

  const content = fs.readFileSync(checkpointPath, 'utf-8');
  const lines = content.split('\n');
  const checkpoints: ParsedCheckpoint[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line?.trim() || '';

    if (trimmed.startsWith('- [')) {
      const isChecked = trimmed.includes('[x]') || trimmed.includes('[X]');
      const text = trimmed.replace(/- \[[xX ]\] /, '').trim();

      checkpoints.push({
        id: '',  // 暂时为空，后续分配
        text,
        checked: isChecked,
        lineIndex: i,
      });
    }
  }

  // 分配ID（从meta.json获取或生成）
  const task = readTaskMeta(taskId, cwd);
  const existingCheckpoints = task?.checkpoints || [];

  checkpoints.forEach((cp, index) => {
    // 尝试通过文本匹配找到现有ID
    const existing = existingCheckpoints.find(ec => ec.description === cp.text);
    if (existing) {
      cp.id = existing.id;
    } else {
      cp.id = generateCheckpointId(taskId, index, cp.text);
    }
  });

  return checkpoints;
}

/**
 * 从检查点描述和任务元数据中提取测试文件/目录模式
 * 用于生成有意义的 npm test 命令
 */
function extractTestPatterns(desc: string, task?: TaskMeta): string[] {
  const patterns: string[] = [];

  // 1. 从描述中提取源文件路径并转换为测试路径
  const srcFileMatch = desc.match(/(?:src\/[\w/.-]+)\.[a-z]+/g);
  if (srcFileMatch) {
    for (const f of srcFileMatch) {
      // src/utils/foo.ts -> foo
      const base = path.basename(f, path.extname(f));
      if (base && base.length > 2) {
        patterns.push(base);
      }
    }
  }

  // 2. 从描述中提取模块/功能名称
  const moduleKeywords = desc.match(
    /(?:验证|测试|检查|test|verify|check|validate)\s*([\w-]{3,})/i
  );
  if (moduleKeywords?.[1]) {
    patterns.push(moduleKeywords[1].toLowerCase());
  }

  // 3. 从任务标题中提取关键词
  if (task?.title) {
    const titleWords = task.title.match(/[a-zA-Z][a-zA-Z0-9-]{2,}/g);
    if (titleWords) {
      for (const w of titleWords) {
        if (!patterns.includes(w.toLowerCase())) {
          patterns.push(w.toLowerCase());
          break; // 只取标题中第一个关键词
        }
      }
    }
  }

  // 4. 从任务描述中的文件引用推断测试模式
  if (task?.description) {
    const descFiles = task.description.match(/src\/([\w/-]+)\.[a-z]+/g);
    if (descFiles) {
      for (const f of descFiles.slice(0, 2)) {
        const dir = path.dirname(f).replace('src/', '');
        if (dir && dir !== '.' && dir.length > 2) {
          patterns.push(dir);
          break;
        }
      }
    }
  }

  return [...new Set(patterns)].slice(0, 2);
}

/**
 * 检查点描述关键词到验证方法的映射
 * 用于自动推断检查点的验证方法
 */
const VERIFICATION_KEYWORDS: Array<{
  method: VerificationMethod;
  keywords: RegExp;
  commands: (desc: string, task?: TaskMeta) => string[];
  expected: string;
  category: 'code_review' | 'qa_verification';
}> = [
  {
    method: 'functional_test',
    keywords: /功能测试|功能验证|functional.?test|功能检查|功能正常|验证功能|测试通过|测试验证|功能工作/,
    commands: (desc, task) => {
      // 从描述中提取关键词生成测试命令
      const patterns = extractTestPatterns(desc, task);
      if (patterns.length > 0) {
        return patterns.map(p => `npm test -- --testPathPattern="${p}"`);
      }
      return ['npm test'];
    },
    expected: '所有功能测试通过，无失败用例',
    category: 'qa_verification',
  },
  {
    method: 'unit_test',
    keywords: /单元测试|unit.?test|ut测试|单元覆盖/,
    commands: (desc, task) => {
      const patterns = extractTestPatterns(desc, task);
      if (patterns.length > 0) {
        return patterns.map(p => `npm test -- --testPathPattern="${p}"`);
      }
      return ['npm test'];
    },
    expected: '所有单元测试通过',
    category: 'qa_verification',
  },
  {
    method: 'integration_test',
    keywords: /集成测试|integration.?test|接口测试/,
    commands: (desc) => ['npm run test:integration'],
    expected: '所有集成测试通过',
    category: 'qa_verification',
  },
  {
    method: 'e2e_test',
    keywords: /端到端|e2e.?test|end.?to.?end|全链路/,
    commands: (desc) => ['npm run test:e2e'],
    expected: '所有 E2E 测试通过',
    category: 'qa_verification',
  },
  {
    method: 'lint',
    keywords: /lint|静态检查|代码风格|eslint|代码规范/,
    commands: (desc) => ['npm run lint'],
    expected: '无 lint 错误或警告',
    category: 'code_review',
  },
  {
    method: 'code_review',
    keywords: /代码审查|code.?review|代码审核/,
    commands: () => [],
    expected: '代码审查通过，无待处理意见',
    category: 'code_review',
  },
  {
    method: 'automated',
    keywords: /自动化验证|自动检查|自动化测试|automated/,
    commands: (desc) => ['npm test'],
    expected: '自动化验证通过',
    category: 'qa_verification',
  },
];

/**
 * 为 automated 方法但缺少 commands/steps 的检查点生成回退验证
 * 从描述中提取文件引用生成验证步骤，默认回退 bun run build + bun test
 */
export function generateFallbackVerification(
  description: string,
  task?: TaskMeta
): CheckpointVerification {
  const commands: string[] = [];
  const steps: string[] = [];

  // 1. 从描述中提取 src/ 路径文件引用，生成文件存在性验证步骤
  const srcFileMatches = description.match(/src\/[\w/.-]+\.[a-z]+/g);
  if (srcFileMatches) {
    const uniqueFiles = [...new Set(srcFileMatches)];
    for (const file of uniqueFiles.slice(0, 5)) {
      steps.push(`确认文件 ${file} 存在并包含预期实现`);
    }
  }

  // 2. 从描述中提取模块/函数名关键词
  const funcMatches = description.match(/(?:函数|function)\s+([a-zA-Z_]\w{2,})/i);
  if (funcMatches?.[1]) {
    steps.push(`确认 ${funcMatches[1]} 函数已导出且可调用`);
  }

  // 3. 从描述中提取类名关键词
  const classMatches = description.match(/(?:类|class)\s+([A-Z]\w{2,})/i);
  if (classMatches?.[1]) {
    steps.push(`确认 ${classMatches[1]} 类已导出且可实例化`);
  }

  // 4. 默认回退验证命令
  commands.push('bun run build');
  commands.push('bun test');

  // 5. 构建 expected 描述
  const expectedParts: string[] = [];
  if (steps.length > 0) {
    expectedParts.push('文件引用验证通过');
  }
  expectedParts.push('bun run build 编译成功', 'bun test 测试通过');

  return {
    method: 'automated',
    commands,
    steps: steps.length > 0 ? steps : undefined,
    expected: expectedParts.join('；'),
  };
}

/**
 * 根据检查点描述推断验证方法
 * 返回推断的 CheckpointVerification 或 undefined（无法推断时）
 */
export function inferVerificationFromDescription(
  description: string,
  task?: TaskMeta
): CheckpointVerification | undefined {
  const lowerDesc = description.toLowerCase();

  for (const rule of VERIFICATION_KEYWORDS) {
    if (rule.keywords.test(lowerDesc)) {
      const commands = rule.commands(description, task);
      return {
        method: rule.method,
        commands: commands.length > 0 ? commands : undefined,
        expected: rule.expected,
      };
    }
  }

  return undefined;
}

/**
 * 为检查点推断验证类别
 */
export function inferCheckpointCategory(
  description: string
): 'code_review' | 'qa_verification' | undefined {
  const lowerDesc = description.toLowerCase();

  // 代码审查类
  if (/代码审查|code.?review|代码审核|lint|静态检查/.test(lowerDesc)) {
    return 'code_review';
  }

  // QA 验证类
  if (/测试|test|验证|verify|检查|功能|qa/.test(lowerDesc)) {
    return 'qa_verification';
  }

  return undefined;
}

/**
 * 将检查点同步到任务元数据（重载版本）
 * @param taskId 任务ID
 * @param checkpoints 检查点列表
 * @param cwd 工作目录
 */
export function syncCheckpointsToMeta(
  taskId: string,
  checkpoints: CheckpointMetadata[],
  cwd?: string
): void;

/**
 * 同步 checkpoint.md 到 meta.json
 * 确保检查点元数据与 checkpoint.md 文件保持一致
 */
export function syncCheckpointsToMeta(taskId: string, cwd?: string): void;

/**
 * 实现：同步检查点到 meta.json
 * 支持两种调用方式：
 * 1. syncCheckpointsToMeta(taskId, cwd) - 从 checkpoint.md 同步
 * 2. syncCheckpointsToMeta(taskId, checkpoints, cwd) - 直接同步指定检查点
 */
export function syncCheckpointsToMeta(
  taskId: string,
  checkpointsOrCwd?: CheckpointMetadata[] | string,
  maybeCwd?: string
): void {
  // 解析参数
  const cwd = typeof checkpointsOrCwd === 'string'
    ? checkpointsOrCwd
    : (maybeCwd ?? process.cwd());
  const checkpoints = Array.isArray(checkpointsOrCwd) ? checkpointsOrCwd : undefined;

  const task = readTaskMeta(taskId, cwd);
  if (!task) {
    throw new Error(`任务 '${taskId}' 不存在`);
  }

  // 如果传入了检查点列表，直接使用；否则从 checkpoint.md 解析
  if (checkpoints && Array.isArray(checkpoints)) {
    // 直接同步传入的检查点
    task.checkpoints = checkpoints;
    writeTaskMeta(task, cwd);

    // 同时更新 checkpoint.md 文件
    updateCheckpointMdFromArray(taskId, checkpoints, cwd);
    return;
  }

  // 原有的逻辑：从 checkpoint.md 解析并同步
  const parsedCheckpoints = parseCheckpointsWithIds(taskId, cwd);
  const existingMeta = task.checkpoints || [];
  const now = new Date().toISOString();

  // 过滤低质量检查点（AI 解析伪影）
  const checkpointTexts = parsedCheckpoints.map(cp => cp.text);
  const filterResult = filterLowQualityCheckpoints(checkpointTexts);
  const filteredCheckpoints = parsedCheckpoints.filter(
    cp => !filterResult.removed.includes(cp.text)
  );

  // 如果没有检查点，清空 meta 中的 checkpoints
  if (filteredCheckpoints.length === 0) {
    if (task.checkpoints && task.checkpoints.length > 0) {
      task.checkpoints = [];
      writeTaskMeta(task, cwd);
    }
    return;
  }

  // 合并现有元数据和新解析的检查点（已过滤）
  const mergedCheckpoints: CheckpointMetadata[] = filteredCheckpoints.map((cp, index) => {
    const existing = existingMeta.find(ec => ec.id === cp.id || ec.description === cp.text);

    // 如果已有验证信息，保留；否则尝试推断
    let verification = existing?.verification;
    let category = existing?.category;

    // 根据前缀推断检查点属性
    const prefixAttributes = inferCheckpointAttributesFromPrefix(cp.text);

    if (!verification) {
      verification = inferVerificationFromDescription(cp.text, task);
    }

    // 如果前缀推断出了验证方法，优先使用前缀推断的方法
    if (prefixAttributes.verificationMethod) {
      verification = {
        ...verification,
        method: prefixAttributes.verificationMethod,
      };
    }

    // 为 automated 方法但缺少 commands/steps 的检查点生成回退验证
    if (verification?.method === 'automated') {
      const hasCommands = verification.commands && verification.commands.length > 0;
      const hasSteps = verification.steps && verification.steps.length > 0;
      if (!hasCommands && !hasSteps) {
        verification = generateFallbackVerification(cp.text, task);
      }
    }

    if (!category) {
      category = inferCheckpointCategory(cp.text);
    }

    // 根据前缀确定 requiresHuman
    // 优先级: 前缀推断 > 现有值
    let requiresHuman: boolean | undefined;
    if (prefixAttributes.requiresHuman !== undefined) {
      requiresHuman = prefixAttributes.requiresHuman;
    } else if (existing?.requiresHuman !== undefined) {
      requiresHuman = existing.requiresHuman;
    }
    // 其他情况保持 undefined（使用默认值）

    return {
      id: cp.id,
      description: cp.text,
      status: cp.checked ? 'completed' : (existing?.status || 'pending'),
      category,
      requiresHuman,
      note: existing?.note,
      verification,
      createdAt: existing?.createdAt || now,
      updatedAt: existing?.updatedAt || now,
    };
  });

  // 检查是否有变化
  const hasChanges = JSON.stringify(task.checkpoints) !== JSON.stringify(mergedCheckpoints);

  if (hasChanges) {
    task.checkpoints = mergedCheckpoints;
    writeTaskMeta(task, cwd);
  }
}

/**
 * 更新检查点状态
 */
export function updateCheckpointStatus(
  taskId: string,
  checkpointId: string,
  status: 'completed' | 'failed' | 'skipped' | 'pending',
  options: {
    note?: string;
    result?: string;
    verifiedBy?: string;
  } = {},
  cwd: string = process.cwd()
): void {
  const task = readTaskMeta(taskId, cwd);
  if (!task) {
    throw new Error(`任务 '${taskId}' 不存在`);
  }

  // 确保检查点已同步
  syncCheckpointsToMeta(taskId, cwd);

  // 重新读取更新后的任务
  const updatedTask = readTaskMeta(taskId, cwd);
  if (!updatedTask) {
    throw new Error(`任务 '${taskId}' 不存在`);
  }

  const checkpoint = updatedTask.checkpoints?.find(cp => cp.id === checkpointId);
  if (!checkpoint) {
    throw new Error(`检查点 '${checkpointId}' 不存在`);
  }

  // 更新状态
  checkpoint.status = status;
  checkpoint.updatedAt = new Date().toISOString();

  // 更新备注
  if (options.note !== undefined) {
    checkpoint.note = options.note;
  }

  // 更新验证结果
  if (options.result !== undefined) {
    if (!checkpoint.verification) {
      checkpoint.verification = {
        method: 'automated',
      };
    }
    checkpoint.verification.result = options.result;
    checkpoint.verification.verifiedAt = new Date().toISOString();
    checkpoint.verification.verifiedBy = options.verifiedBy || process.env.USER || 'unknown';
  }

  // 同步回 checkpoint.md（更新勾选状态）
  updateCheckpointMd(taskId, checkpointId, status === 'completed', updatedTask, cwd);

  writeTaskMeta(updatedTask, cwd);
}

/**
 * 更新 checkpoint.md 文件的勾选状态
 */
function updateCheckpointMd(
  taskId: string,
  checkpointId: string,
  checked: boolean,
  task: TaskMeta,
  cwd: string = process.cwd()
): void {
  const checkpointPath = path.join(getTasksDir(cwd), taskId, 'checkpoint.md');

  if (!fs.existsSync(checkpointPath)) return;

  const content = fs.readFileSync(checkpointPath, 'utf-8');
  const lines = content.split('\n');

  // 找到对应的检查点
  const checkpoint = task.checkpoints?.find(cp => cp.id === checkpointId);

  if (!checkpoint) return;

  // 找到匹配的行并更新
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line && line.trim().startsWith('- [') && line.includes(checkpoint.description)) {
      lines[i] = line.replace(/- \[[xX ]\] /, checked ? '- [x] ' : '- [ ] ');
      break;
    }
  }

  fs.writeFileSync(checkpointPath, lines.join('\n'), 'utf-8');
}

/**
 * 获取检查点详情
 */
export function getCheckpointDetail(
  taskId: string,
  checkpointId: string,
  cwd: string = process.cwd()
): CheckpointMetadata | null {
  syncCheckpointsToMeta(taskId, cwd);
  const task = readTaskMeta(taskId, cwd);
  return task?.checkpoints?.find(cp => cp.id === checkpointId) || null;
}

/**
 * 列出所有检查点
 */
export function listCheckpoints(
  taskId: string,
  cwd: string = process.cwd()
): CheckpointMetadata[] {
  syncCheckpointsToMeta(taskId, cwd);
  const task = readTaskMeta(taskId, cwd);
  return task?.checkpoints || [];
}

/**
 * 通过描述查找检查点ID
 */
export function findCheckpointIdByDescription(
  taskId: string,
  description: string,
  cwd: string = process.cwd()
): string | null {
  const checkpoints = listCheckpoints(taskId, cwd);
  const found = checkpoints.find(cp =>
    cp.description === description ||
    cp.description.includes(description) ||
    description.includes(cp.description)
  );
  return found?.id || null;
}

/**
 * 从检查点数组更新 checkpoint.md 文件
 * @param taskId 任务ID
 * @param checkpoints 检查点数组
 * @param cwd 工作目录
 */
function updateCheckpointMdFromArray(
  taskId: string,
  checkpoints: CheckpointMetadata[],
  cwd: string = process.cwd()
): void {
  const checkpointPath = path.join(getTasksDir(cwd), taskId, 'checkpoint.md');
  const content = `# ${taskId} 检查点\n\n` +
    checkpoints.map(cp => `- [ ] ${cp.description}`).join('\n') +
    '\n';
  fs.writeFileSync(checkpointPath, content, 'utf-8');
}

/**
 * 修复缺失的检查点选项
 */
export interface FixMissingCheckpointsOptions {
  /** 是否使用 AI 生成检查点 */
  useAI?: boolean;
  /** 任务标题（用于生成默认检查点） */
  taskTitle?: string;
  /** 任务描述（用于推断检查点） */
  taskDescription?: string;
  /** 相关文件列表 */
  relatedFiles?: string[];
}

/**
 * 修复缺失的检查点
 * 智能生成缺失的检查点并返回完整的检查点列表
 * @param taskId 任务ID
 * @param options 修复选项
 * @param cwd 工作目录
 * @returns 修复后的检查点列表
 */
export async function fixMissingCheckpoints(
  taskId: string,
  options: FixMissingCheckpointsOptions = {},
  cwd: string = process.cwd()
): Promise<CheckpointMetadata[]> {
  const task = readTaskMeta(taskId, cwd);
  if (!task) {
    throw new Error(`任务 '${taskId}' 不存在`);
  }

  const now = new Date().toISOString();
  const existingCheckpoints = task.checkpoints || [];

  // 如果已有检查点，直接返回
  if (existingCheckpoints.length > 0) {
    return existingCheckpoints;
  }

  // 智能生成检查点
  const generatedCheckpoints = await generateCheckpointsForTask(task, options, cwd);

  // 合并现有和新生成的检查点
  const mergedCheckpoints = mergeCheckpoints(existingCheckpoints, generatedCheckpoints);

  return mergedCheckpoints;
}

/**
 * 为任务生成检查点
 * 基于任务描述和相关信息生成智能检查点
 */
async function generateCheckpointsForTask(
  task: TaskMeta,
  options: FixMissingCheckpointsOptions,
  cwd: string
): Promise<CheckpointMetadata[]> {
  const now = new Date().toISOString();
  const checkpoints: CheckpointMetadata[] = [];

  // 从任务描述中提取验收标准
  const acceptanceCriteria = extractAcceptanceCriteria(
    options.taskDescription || task.description || '',
    options.taskTitle || task.title
  );

  // 基于验收标准生成检查点
  for (let index = 0; index < acceptanceCriteria.length; index++) {
    const criteria = acceptanceCriteria[index]!;
    const id = generateCheckpointId(task.id, index, criteria);

    // 推断验证方法
    const verification = inferVerificationFromDescription(criteria, task);

    checkpoints.push({
      id,
      description: criteria,
      status: 'pending',
      category: inferCheckpointCategory(criteria),
      verification: verification || {
        method: 'automated',
        expected: '验证通过',
      },
      createdAt: now,
      updatedAt: now,
    });
  }

  return checkpoints;
}

/**
 * 从任务描述中提取验收标准
 */
function extractAcceptanceCriteria(description: string, taskTitle?: string): string[] {
  const criteria: string[] = [];
  const content = description || taskTitle || '';

  if (!content.trim()) {
    return criteria;
  }

  // 尝试提取列表项（"- [ ] xxx" 或 "- xxx" 或 "1. xxx" 格式）
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    const match = trimmed.match(/^(?:[-*]|\d+\.)\s*(?:\[[ x]\])?\s*(.+)/);
    if (match?.[1]) {
      const item = match[1].trim();
      if (item.length > 5) { // 过滤过短的项
        criteria.push(item);
      }
    }
  }

  // 如果没有提取到，将整个描述作为一条标准
  if (criteria.length === 0 && content.trim().length > 10) {
    criteria.push(content.trim());
  }

  return criteria;
}

/**
 * 合并现有检查点和新生成的检查点
 * 保留现有的状态信息，避免重复
 */
function mergeCheckpoints(
  existing: CheckpointMetadata[],
  generated: CheckpointMetadata[]
): CheckpointMetadata[] {
  const merged: CheckpointMetadata[] = [];
  const usedExisting = new Set<string>();

  // 首先尝试匹配新生成的检查点与现有检查点
  for (const gen of generated) {
    const match = existing.find(ex =>
      ex.description === gen.description ||
      ex.id === gen.id
    );

    if (match) {
      // 保留现有检查点的状态，但更新其他信息
      merged.push({
        ...gen,
        status: match.status,
        note: match.note,
        verification: match.verification || gen.verification,
        createdAt: match.createdAt,
      });
      usedExisting.add(match.id);
    } else {
      // 全新的检查点
      merged.push(gen);
    }
  }

  // 添加未匹配的现有检查点（保留它们）
  for (const ex of existing) {
    if (!usedExisting.has(ex.id)) {
      merged.push(ex);
    }
  }

  return merged;
}
