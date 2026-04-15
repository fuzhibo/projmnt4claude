/**
 * 检查点质量验证规则集
 *
 * 为 Harness Design 模式提供检查点描述的质量约束验证，
 * 覆盖去重、路径过滤、数量控制、动词前缀和最小长度。
 */

import type {
  ValidationRule,
  ValidationViolation,
} from '../../types/feedback-constraint.js';

// ============================================================
// 数据表
// ============================================================

/** 中文动词表 (30+) */
const CHINESE_VERBS: ReadonlySet<string> = new Set([
  '实现', '编写', '添加', '修复', '验证', '测试',
  '创建', '删除', '更新', '优化', '重构', '设计',
  '配置', '部署', '集成', '替换', '移除', '调整',
  '检查', '分析', '处理', '生成', '转换', '解析',
  '提取', '计算', '排序', '过滤', '合并', '拆分',
  '初始化', '注册', '加载', '保存', '导出', '导入',
]);

/** 英文动词表 (20+) */
const ENGLISH_VERBS: ReadonlySet<string> = new Set([
  'implement', 'add', 'create', 'fix', 'verify', 'test',
  'update', 'remove', 'delete', 'optimize', 'refactor', 'design',
  'configure', 'deploy', 'integrate', 'replace', 'adjust', 'check',
  'analyze', 'handle', 'generate', 'convert', 'parse', 'extract',
  'initialize', 'register', 'load', 'save', 'export', 'import',
]);

/** 否定模式正则表 */
const NEGATIVE_PATTERNS: ReadonlyArray<RegExp> = [
  /(?:^|[/\\])[\w-]+\.\w{1,10}$/,           // 文件路径 (含扩展名)
  /^\d+(\.\d+)*$/,                            // 纯序号
  /^[A-Z]+-\d+/,                              // ID 前缀 (如 CP-A3-1)
  /^src[/\\]/,                                // src 开头路径
  /^[a-f0-9]{7,}$/i,                          // 短 hash
  /^v?\d+\.\d+(\.\d+)?$/,                     // 版本号
];

// ============================================================
// 辅助函数
// ============================================================

/** 归一化：去除首尾空白、统一空白字符、转小写 */
function normalize(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** 生成字符 bigram 集合 */
function bigrams(text: string): Set<string> {
  const result = new Set<string>();
  for (let i = 0; i < text.length - 1; i++) {
    result.add(text.slice(i, i + 2));
  }
  return result;
}

/** 计算 bigram Jaccard 相似度 */
function jaccardSimilarity(a: string, b: string): number {
  const setA = bigrams(a);
  const setB = bigrams(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const gram of setA) {
    if (setB.has(gram)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** 判断字符串是否为纯文件路径格式 */
function isFilePath(text: string): boolean {
  return /\.(ts|tsx|js|jsx|json|md|yaml|yml|css|html|py|go|rs|java|vue|svelte|sh|sql|xml|toml|cfg|ini|conf|txt|log)\b/i.test(text)
    && /[/\\]/.test(text);
}

/** 判断字符串首词是否为已知动词 */
function startsWithVerb(text: string): boolean {
  const firstWord = (text.trim().split(/[\s/:：（(]/)[0] ?? '').toLowerCase();
  if (!firstWord) return false;

  // 中文：检查前缀是否包含中文动词
  for (const verb of CHINESE_VERBS) {
    if (firstWord.startsWith(verb)) return true;
  }

  // 英文：精确匹配或常见时态变形
  if (ENGLISH_VERBS.has(firstWord)) return true;
  // 处理 -ed / -ing / -es / -s 变形
  const stemCandidates = [
    firstWord.replace(/ing$/, '').replace(/(.)(.)$/, '$1$2e'),  // running -> runne -> (fallback)
    firstWord.replace(/ed$/, ''),
    firstWord.replace(/es$/, ''),
    firstWord.replace(/s$/, ''),
  ];
  for (const candidate of stemCandidates) {
    if (ENGLISH_VERBS.has(candidate)) return true;
  }

  return false;
}

// ============================================================
// 验证规则
// ============================================================

/**
 * Rule 1: checkpointNoDuplicate (severity: error)
 * 三层去重：L1 归一化精确匹配 → L2 子串包含 → L3 bigram Jaccard ≥ 0.7
 */
export const checkpointNoDuplicate: ValidationRule = {
  id: 'checkpoint-no-duplicate',
  description: '检查点描述不允许重复（三层去重：归一化精确匹配、子串包含、bigram Jaccard≥0.7）',
  severity: 'error' as const,
  check: (output: unknown): ValidationViolation | null => {
    const checkpoints = extractCheckpointDescriptions(output);
    if (checkpoints.length <= 1) return null;

    const duplicates: string[] = [];
    const seen = new Map<number, string>(); // index -> normalized

    for (let i = 0; i < checkpoints.length; i++) {
      const cp = checkpoints[i]!;
      const norm = normalize(cp);
      let isDuplicate = false;

      for (const [, prevNorm] of seen) {
        // L1: 归一化精确匹配
        if (norm === prevNorm) {
          isDuplicate = true;
          break;
        }
        // L2: 子串包含（较短者被较长者包含）
        const shorter = norm.length < prevNorm.length ? norm : prevNorm;
        const longer = norm.length < prevNorm.length ? prevNorm : norm;
        if (longer.includes(shorter) && shorter.length >= 4) {
          isDuplicate = true;
          break;
        }
        // L3: bigram Jaccard ≥ 0.7
        if (jaccardSimilarity(norm, prevNorm) >= 0.7) {
          isDuplicate = true;
          break;
        }
      }

      if (isDuplicate) {
        duplicates.push(cp);
      } else {
        seen.set(i, norm);
      }
    }

    if (duplicates.length === 0) return null;

    return {
      ruleId: 'checkpoint-no-duplicate',
      severity: 'error',
      message: `发现 ${duplicates.length} 条重复检查点: ${duplicates.map(d => `"${d}"`).join(', ')}`,
    };
  },
};

/**
 * Rule 2: checkpointNoFilePath (severity: error)
 * 过滤纯文件路径格式的检查点描述
 */
export const checkpointNoFilePath: ValidationRule = {
  id: 'checkpoint-no-file-path',
  description: '检查点描述不能是纯文件路径格式',
  severity: 'error' as const,
  check: (output: unknown): ValidationViolation | null => {
    const checkpoints = extractCheckpointDescriptions(output);
    const filePaths = checkpoints.filter(cp => isFilePath(cp.trim()));

    if (filePaths.length === 0) return null;

    return {
      ruleId: 'checkpoint-no-file-path',
      severity: 'error',
      message: `${filePaths.length} 条检查点为文件路径格式: ${filePaths.map(p => `"${p}"`).join(', ')}`,
    };
  },
};

/**
 * Rule 3: checkpointCountControl (severity: warning >8 / error >15)
 * 控制检查点数量在合理范围内
 */
export const checkpointCountControl: ValidationRule = {
  id: 'checkpoint-count-control',
  description: '检查点数量 >8 条为 warning，>15 条为 error',
  severity: 'warning' as const,
  check: (output: unknown): ValidationViolation | null => {
    const checkpoints = extractCheckpointDescriptions(output);
    const count = checkpoints.length;

    if (count <= 8) return null;

    const severity: 'warning' | 'error' = count > 15 ? 'error' : 'warning';

    return {
      ruleId: 'checkpoint-count-control',
      severity,
      message: `检查点数量 ${count} 条，${count > 15 ? '超过 15 条上限（error）' : '超过 8 条建议上限（warning）'}`,
      value: String(count),
    };
  },
};

/**
 * Rule 4: checkpointVerbPrefix (severity: warning)
 * 检查点描述应以动词开头
 */
export const checkpointVerbPrefix: ValidationRule = {
  id: 'checkpoint-verb-prefix',
  description: '检查点描述应以动词开头（中文动词或英文动词）',
  severity: 'warning' as const,
  check: (output: unknown): ValidationViolation | null => {
    const checkpoints = extractCheckpointDescriptions(output);
    const nonVerb = checkpoints.filter(cp => !startsWithVerb(cp));

    if (nonVerb.length === 0) return null;

    return {
      ruleId: 'checkpoint-verb-prefix',
      severity: 'warning',
      message: `${nonVerb.length} 条检查点未以动词开头: ${nonVerb.map(v => `"${v}"`).join(', ')}`,
    };
  },
};

/**
 * Rule 5: checkpointMinLength (severity: warning)
 * 每条检查点描述至少 10 个字符
 */
export const checkpointMinLength: ValidationRule = {
  id: 'checkpoint-min-length',
  description: '每条检查点描述至少 10 个字符',
  severity: 'warning' as const,
  check: (output: unknown): ValidationViolation | null => {
    const checkpoints = extractCheckpointDescriptions(output);
    const tooShort = checkpoints.filter(cp => cp.trim().length < 10);

    if (tooShort.length === 0) return null;

    return {
      ruleId: 'checkpoint-min-length',
      severity: 'warning',
      message: `${tooShort.length} 条检查点描述不足 10 字符: ${tooShort.map(s => `"${s}" (len=${s.trim().length})`).join(', ')}`,
    };
  },
};

// ============================================================
// 辅助：从未知输出中提取检查点描述数组
// ============================================================

/**
 * 从未知输出中提取字符串数组形式的检查点描述。
 *
 * 支持的输入格式：
 * - string[] — 直接使用
 * - string (JSON) — 尝试解析为数组或从对象中提取 checkpoints/descriptions 字段
 * - object — 尝试取 checkpoints / descriptions / items 字段
 */
function extractCheckpointDescriptions(output: unknown): string[] {
  if (Array.isArray(output)) {
    return output.filter((item): item is string => typeof item === 'string');
  }

  if (typeof output === 'string') {
    const trimmed = output.trim();
    // 尝试 JSON 解析
    try {
      const parsed = JSON.parse(trimmed);
      return extractCheckpointDescriptions(parsed);
    } catch {
      // 非 JSON，按换行拆分
      return trimmed.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    }
  }

  if (output !== null && typeof output === 'object') {
    const obj = output as Record<string, unknown>;
    const candidates = ['checkpoints', 'descriptions', 'items', 'entries'];
    for (const key of candidates) {
      if (Array.isArray(obj[key])) {
        return (obj[key] as unknown[]).filter(
          (item): item is string => typeof item === 'string',
        );
      }
    }
    // 尝试从 checkpoint 对象数组中提取 description 字段
    for (const key of candidates) {
      const arr = obj[key];
      if (Array.isArray(arr)) {
        return arr
          .map((item: unknown) =>
            item !== null && typeof item === 'object'
              ? ((item as Record<string, unknown>).description ?? (item as Record<string, unknown>).text ?? '')
              : '',
          )
          .filter((s): s is string => typeof s === 'string' && s.length > 0);
      }
    }
  }

  return [];
}

/**
 * 从未知输出中提取检查点对象数组。
 *
 * 支持的输入格式：
 * - Array<object> — 对象数组，每个元素作为检查点对象
 * - object (含 checkpoints 字段) — 提取 checkpoints 数组
 * - string (JSON) — 尝试解析后递归提取
 */
function extractCheckpointObjects(output: unknown): Record<string, unknown>[] {
  if (Array.isArray(output)) {
    return output.filter(
      (item): item is Record<string, unknown> =>
        item !== null && typeof item === 'object' && !Array.isArray(item),
    );
  }

  if (typeof output === 'string') {
    try {
      const parsed = JSON.parse(output.trim());
      return extractCheckpointObjects(parsed);
    } catch {
      return [];
    }
  }

  if (output !== null && typeof output === 'object') {
    const obj = output as Record<string, unknown>;
    if (Array.isArray(obj.checkpoints)) {
      return obj.checkpoints.filter(
        (item): item is Record<string, unknown> =>
          item !== null && typeof item === 'object' && !Array.isArray(item),
      );
    }
  }

  return [];
}

// ============================================================
// 结构化检查点验证规则（Rule 6-8）
// ============================================================

/** 需要验证命令的自动化验证方法 */
const METHODS_REQUIRING_COMMANDS: string[] = [
  'functional_test',
  'unit_test',
  'integration_test',
  'e2e_test',
  'automated',
  'lint',
];

/** 允许的检查点描述前缀（验证类别标识） */
export const VALID_CHECKPOINT_PREFIXES: ReadonlyArray<string> = [
  '[ai review]',
  '[ai qa]',
  '[human qa]',
  '[script]',
];

/**
 * 根据检查点前缀映射到 Harness Design 阶段
 *
 * 将验证类别前缀映射为流水线阶段，供检查点阶段推断使用。
 * 无前缀或未知前缀返回 null。
 *
 * 此函数复用 inferCheckpointAttributesFromPrefix 的映射逻辑，
 * 确保前缀映射结果被消费且保持一致。
 *
 * @param description - 检查点描述文本
 * @returns 对应的 Harness Design 阶段名称，或 null
 */
export function getCheckpointPhase(description: string): string | null {
  if (!description || typeof description !== 'string') return null;

  const trimmed = description.trim().toLowerCase();

  // 直接检查前缀（复用 inferCheckpointAttributesFromPrefix 的映射逻辑）
  if (trimmed.startsWith('[ai review]')) return 'code_review';
  if (trimmed.startsWith('[ai qa]')) return 'qa_verification';
  if (trimmed.startsWith('[script]')) return 'evaluation';

  return null;
}

/**
 * 根据检查点前缀推断检查点属性
 *
 * 前缀映射规则：
 * - [ai review] → 无额外属性（默认）
 * - [ai qa] → verification.method=automated
 * - [script] → verification.method=automated
 *
 * @param description - 检查点描述文本
 * @returns 推断的属性对象，包含 requiresHuman 和 verification.method
 */
export function inferCheckpointAttributesFromPrefix(description: string): {
  requiresHuman?: boolean;
  verificationMethod?: 'code_review' | 'lint' | 'unit_test' | 'functional_test' | 'integration_test' | 'e2e_test' | 'architect_review' | 'automated';
} {
  if (!description || typeof description !== 'string') {
    return {};
  }

  const trimmed = description.trim().toLowerCase();

  // [ai qa] → 自动化 QA 验证
  if (trimmed.startsWith('[ai qa]')) {
    return {
      requiresHuman: false,
      verificationMethod: 'automated',
    };
  }

  // [script] → 自动化脚本验证
  if (trimmed.startsWith('[script]')) {
    return {
      requiresHuman: false,
      verificationMethod: 'automated',
    };
  }

  // [ai review] → 默认，不设置额外属性
  if (trimmed.startsWith('[ai review]')) {
    return {
      requiresHuman: false,
    };
  }

  // 无前缀或未知前缀，返回空对象（使用默认逻辑）
  return {};
}

/**
 * 根据检查点描述内容推断合适的前缀
 *
 * 前缀映射规则：
 * - [ai review]: 涉及代码审查、代码质量、代码规范、重构、逻辑正确性
 * - [ai qa]: 涉及测试、验证、覆盖率、自动化检查
 * - [human qa]: 涉及人工确认、用户体验、手动操作、UI/UX、设计稿
 * - [script]: 涉及脚本、构建、命令执行、CI/CD、部署
 * - 默认: [ai review]
 *
 * @param description - 检查点描述文本
 * @returns 推断的前缀字符串（包含方括号）
 */
export function inferCheckpointPrefix(description: string): string {
  if (!description || typeof description !== 'string') {
    return '[ai review]';
  }

  const lowerDesc = description.toLowerCase();

  // [ai qa] 关键词: 测试、验证、覆盖率
  const aiQaKeywords = [
    '测试', '验证', '覆盖率', 'test', 'testing', 'verify',
    'verification', 'coverage', '单元测试', '集成测试', 'e2e',
    '自动化', 'automated', '回归', 'regression', 'lint',
    '静态分析', 'type check', '类型检查',
  ];

  // [human qa] 关键词: 人工确认、用户体验、手动操作
  const humanQaKeywords = [
    '人工', '手动', '用户体验', 'ux', 'ui', '界面', '设计稿',
    '交互', '视觉效果', '样式', '布局', '手动测试', '人工确认',
    '用户确认', '视觉检查', '视觉验证', 'design', 'visual',
    'mockup', 'prototype', '原型',
  ];

  // [script] 关键词: 脚本、构建、命令执行
  const scriptKeywords = [
    '脚本', '构建', '编译', '部署', 'ci/cd', 'pipeline',
    'script', 'build', 'compile', 'deploy', '发布', 'publish',
    '打包', 'bundle', 'install', 'npm run', 'yarn ', 'pnpm ',
    '命令', 'command', 'shell', 'bash', 'npm install', '依赖安装',
  ];

  // [ai review] 关键词: 代码审查、代码质量
  const aiReviewKeywords = [
    '代码审查', '代码质量', '重构', '代码规范', '风格',
    'review', 'refactor', 'quality', '规范', '命名',
    '逻辑正确', '边界处理', '错误处理', '异常处理',
    '性能优化', '复杂度', '可读性', '可维护性',
  ];

  // 计算各分类匹配次数
  const matches = {
    '[ai qa]': aiQaKeywords.filter(kw => lowerDesc.includes(kw)).length,
    '[human qa]': humanQaKeywords.filter(kw => lowerDesc.includes(kw)).length,
    '[script]': scriptKeywords.filter(kw => lowerDesc.includes(kw)).length,
    '[ai review]': aiReviewKeywords.filter(kw => lowerDesc.includes(kw)).length,
  };

  // 找到匹配次数最多的分类
  const sorted = Object.entries(matches).sort((a, b) => b[1] - a[1]);
  const [bestMatch, bestCount] = sorted[0]!;

  // 如果有明确匹配（至少1个关键词），返回对应前缀
  if (bestCount > 0) {
    return bestMatch;
  }

  // 默认返回 [ai review]
  return '[ai review]';
}

/**
 * Rule 6: checkpointRequiredPrefix (severity: error)
 * 检查点描述必须以验证类别前缀开头: [ai review] / [ai qa] / [human qa] / [script]
 */
export const checkpointRequiredPrefix: ValidationRule = {
  id: 'checkpoint-required-prefix',
  description: '检查点描述必须以 [ai review]/[ai qa]/[human qa]/[script] 前缀开头',
  severity: 'error' as const,
  check: (output: unknown): ValidationViolation | null => {
    const checkpoints = extractCheckpointObjects(output);
    if (checkpoints.length === 0) return null;

    const invalid = checkpoints.filter(cp => {
      const desc = cp['description'];
      if (typeof desc !== 'string') return true;
      const trimmed = desc.trim().toLowerCase();
      return !VALID_CHECKPOINT_PREFIXES.some(prefix => trimmed.startsWith(prefix));
    });

    if (invalid.length === 0) return null;

    return {
      ruleId: 'checkpoint-required-prefix',
      severity: 'error',
      message: `${invalid.length} 条检查点描述缺少验证类别前缀 ([ai review]/[ai qa]/[human qa]/[script]): ${invalid.map(cp => `"${cp['description'] ?? cp['id'] ?? 'unknown'}"`).join(', ')}`,
    };
  },
};

/**
 * Rule 7: checkpointHasVerificationCommands (severity: warning)
 * 使用自动化验证方法的检查点应包含验证命令或步骤
 */
export const checkpointHasVerificationCommands: ValidationRule = {
  id: 'checkpoint-has-verification-commands',
  description: '使用自动化验证方法的检查点应包含 verification.commands 或 verification.steps',
  severity: 'warning' as const,
  check: (output: unknown): ValidationViolation | null => {
    const checkpoints = extractCheckpointObjects(output);
    if (checkpoints.length === 0) return null;

    const missing: Record<string, unknown>[] = [];

    for (const cp of checkpoints) {
      const verification = cp['verification'] as Record<string, unknown> | undefined;
      if (!verification || typeof verification !== 'object') continue;

      const method = verification['method'] as string;
      if (!method || !METHODS_REQUIRING_COMMANDS.includes(method)) continue;

      const commands = verification['commands'] as unknown[] | undefined;
      const steps = verification['steps'] as unknown[] | undefined;
      const hasCommands = Array.isArray(commands) && commands.length > 0;
      const hasSteps = Array.isArray(steps) && steps.length > 0;

      if (!hasCommands && !hasSteps) {
        missing.push(cp);
      }
    }

    if (missing.length === 0) return null;

    return {
      ruleId: 'checkpoint-has-verification-commands',
      severity: 'warning',
      message: `${missing.length} 条检查点的自动化验证方法缺少 commands 或 steps: ${missing.map(cp => {
        const desc = (cp['description'] as string) || (cp['id'] as string) || 'unknown';
        const method = ((cp['verification'] as Record<string, unknown>)?.['method'] as string) || '';
        return `"${desc}" (method: ${method})`;
      }).join(', ')}`,
    };
  },
};

/**
 * 检测字符串值中的 JSON 格式问题：
 * - 未转义引号（值中间出现裸引号）
 * - 控制字符（\x00-\x1F 除 \t \n \r 外）
 * - 截断/不完整的字符串
 */
function detectStringFormatIssues(value: string): string[] {
  const issues: string[] = [];

  // 检测未转义的控制字符
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) {
    issues.push('contains unescaped control characters');
  }

  // 检测未转义引号：字符串中间出现 " 但不是 \" 或开头/结尾的引号
  // 先去除合法转义引号，再检查是否有裸引号混在字符串中间
  const withoutEscapes = value.replace(/\\"/g, '');
  // 匹配: 非引号字符 + 裸引号 + 非引号字符 (表示引号嵌入在文本中)
  if (/[^"]"[^"]/.test(withoutEscapes)) {
    issues.push('contains unescaped quotes');
  }

  return issues;
}

/**
 * Rule 8: metaJsonValid (severity: error)
 * 验证任务 meta.json 结构完整性和 JSON 格式正确性
 */
export const metaJsonValid: ValidationRule = {
  id: 'meta-json-valid',
  description: 'meta.json 必须包含必需字段、值合法且 JSON 格式正确',
  severity: 'error' as const,
  check: (output: unknown): ValidationViolation | null => {
    // JSON 格式验证：当输入为字符串时，尝试解析并捕获语法错误
    if (typeof output === 'string') {
      try {
        JSON.parse(output);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          ruleId: 'meta-json-valid',
          severity: 'error',
          message: `meta.json JSON 格式错误: ${msg}`,
        };
      }
      // 解析成功后递归验证结构
      return metaJsonValid.check(JSON.parse(output));
    }

    if (typeof output !== 'object' || output === null) return null;

    const obj = output as Record<string, unknown>;
    const errors: string[] = [];

    // 必需字段检查
    if (!obj['id'] || typeof obj['id'] !== 'string') errors.push('id');
    if (!obj['title'] || typeof obj['title'] !== 'string') errors.push('title');
    if (!obj['type'] || typeof obj['type'] !== 'string') errors.push('type');
    if (!obj['status'] || typeof obj['status'] !== 'string') errors.push('status');
    if (!Array.isArray(obj['dependencies'])) errors.push('dependencies');
    if (!Array.isArray(obj['history'])) errors.push('history');
    if (!Array.isArray(obj['checkpoints'])) errors.push('checkpoints');
    if (!Array.isArray(obj['subtaskIds'])) errors.push('subtaskIds');
    if (!Array.isArray(obj['discussionTopics'])) errors.push('discussionTopics');
    if (!Array.isArray(obj['fileWarnings'])) errors.push('fileWarnings');
    if (!Array.isArray(obj['allowedTools'])) errors.push('allowedTools');
    if (!obj['createdAt'] || typeof obj['createdAt'] !== 'string') errors.push('createdAt');
    if (!obj['updatedAt'] || typeof obj['updatedAt'] !== 'string') errors.push('updatedAt');

    // 字符串字段 JSON 格式检查（未转义引号、控制字符等）
    const stringFields = ['id', 'title', 'type', 'status', 'description'] as const;
    for (const field of stringFields) {
      const val = obj[field];
      if (typeof val === 'string') {
        const issues = detectStringFormatIssues(val);
        if (issues.length > 0) {
          errors.push(`${field}(${issues.join('; ')})`);
        }
      }
    }

    // 状态值校验
    const validStatuses = [
      'open', 'in_progress', 'wait_review', 'wait_qa', 'wait_evaluation',
      'resolved', 'closed', 'abandoned', 'failed',
    ];
    const status = obj['status'];
    if (typeof status === 'string' && !validStatuses.includes(status)) {
      errors.push(`status(Invalid value: "${status}")`);
    }

    // 优先级值校验
    const validPriorities = ['P0', 'P1', 'P2', 'P3', 'Q1', 'Q2', 'Q3', 'Q4'];
    const priority = obj['priority'];
    if (priority !== undefined && typeof priority === 'string' && !validPriorities.includes(priority)) {
      errors.push(`priority(Invalid value: "${priority}")`);
    }

    if (errors.length === 0) return null;

    return {
      ruleId: 'meta-json-valid',
      severity: 'error',
      message: `meta.json 验证失败: ${errors.join(', ')}`,
    };
  },
};

// ============================================================
// 导出规则集
// ============================================================

/** 所有检查点质量验证规则 */
export const checkpointValidationRules: ValidationRule[] = [
  checkpointNoDuplicate,
  checkpointNoFilePath,
  checkpointCountControl,
  checkpointVerbPrefix,
  checkpointMinLength,
  checkpointRequiredPrefix,
  checkpointHasVerificationCommands,
  metaJsonValid,
];
