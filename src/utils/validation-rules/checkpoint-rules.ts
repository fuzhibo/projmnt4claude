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
];
