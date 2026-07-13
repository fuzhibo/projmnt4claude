/**
 * 事实准确性验证模块 (SOL-005)
 *
 * 解析报告中的代码引用并验证其存在性
 */

import type { InvestigationReport } from './types';
import { createLogger } from '../logger';
import * as fs from 'fs';
import * as path from 'path';

/** 代码引用结构 */
export interface CodeReference {
  /** 引用类型 */
  type: 'file' | 'function' | 'line' | 'unknown';
  /** 文件路径 */
  filePath: string;
  /** 函数名（可选） */
  functionName?: string;
  /** 行号（可选） */
  lineNumber?: number;
  /** 原始引用文本 */
  rawText: string;
}

/** 验证结果 */
export interface ReferenceVerification {
  reference: CodeReference;
  exists: boolean;
  error?: string;
}

/** 事实准确性验证结果 */
export interface FactAccuracyResult {
  /** 总引用数 */
  totalReferences: number;
  /** 有效引用数 */
  validReferences: number;
  /** 准确性分数 (0-100) */
  score: number;
  /** 详细验证结果 */
  details: ReferenceVerification[];
}

// 代码引用匹配模式
const PATTERNS = {
  // 文件路径: src/path/to/file.ts 或 ./path/to/file.ts
  filePath: /(?:^|\s|['"`])(\.?\/?[\w\-./]+\.[a-z]{1,4})(?:\s|['"`]|:|$)/gi,
  // 函数引用: function functionName 或 func functionName 或 functionName()
  functionRef: /(?:function\s+|func\s+|def\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\s*\([^)]*\)/g,
  // 行号引用: :123 或 line 123 或 L123
  lineRef: /:([1-9]\d*)|line\s+([1-9]\d*)|L([1-9]\d*)/gi,
  // 完整引用: file.ts:functionName 或 file.ts:123
  fullRef: /([\w\-./]+\.[a-z]{1,4}):([a-zA-Z_][a-zA-Z0-9_]*|[1-9]\d*)/g,
};

/**
 * 从报告文本中解析代码引用
 */
export function parseCodeReferences(text: string): CodeReference[] {
  const references: CodeReference[] = [];
  const seen = new Set<string>();

  // 1. 解析完整引用 (file.ts:functionName 或 file.ts:123)
  let match;
  const fullRefRegex = new RegExp(PATTERNS.fullRef.source, 'gi');
  while ((match = fullRefRegex.exec(text)) !== null) {
    const filePath = match[1]!;
    const secondary = match[2]!;
    const key = `${filePath}:${secondary}`;

    if (!seen.has(key)) {
      seen.add(key);
      // 判断是函数名还是行号
      if (/^[1-9]\d*$/.test(secondary)) {
        references.push({
          type: 'line',
          filePath,
          lineNumber: parseInt(secondary, 10),
          rawText: match[0],
        });
      } else {
        references.push({
          type: 'function',
          filePath,
          functionName: secondary,
          rawText: match[0],
        });
      }
    }
  }

  // 2. 解析独立文件路径
  const filePathRegex = new RegExp(PATTERNS.filePath.source, 'gi');
  while ((match = filePathRegex.exec(text)) !== null) {
    const filePath = match[1];
    if (!filePath) continue;
    // 排除已处理的完整引用
    if (!seen.has(filePath) && isValidSourcePath(filePath)) {
      seen.add(filePath);
      references.push({
        type: 'file',
        filePath,
        rawText: match[0] || filePath,
      });
    }
  }

  return references;
}

/**
 * 判断是否为有效的源代码路径
 */
function isValidSourcePath(filePath: string): boolean {
  // 排除常见非代码路径
  const invalidPrefixes = ['http://', 'https://', 'node_modules'];
  if (invalidPrefixes.some(p => filePath.startsWith(p))) {
    return false;
  }

  // 只接受常见源代码扩展名
  const validExtensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.c', '.cpp', '.h'];
  return validExtensions.some(ext => filePath.endsWith(ext));
}

/**
 * 验证单个代码引用
 */
export function verifyReference(
  reference: CodeReference,
  projectRoot: string,
): ReferenceVerification {
  const logger = createLogger('fact-verifier');

  // 构建完整文件路径
  const fullPath = path.isAbsolute(reference.filePath)
    ? reference.filePath
    : path.join(projectRoot, reference.filePath);

  // 检查文件是否存在
  if (!fs.existsSync(fullPath)) {
    logger.debug('Reference file not found', { filePath: fullPath, rawText: reference.rawText });
    return {
      reference,
      exists: false,
      error: `文件不存在: ${reference.filePath}`,
    };
  }

  // 文件引用类型，直接返回成功
  if (reference.type === 'file') {
    return { reference, exists: true };
  }

  // 读取文件内容进行进一步验证
  try {
    const content = fs.readFileSync(fullPath, 'utf-8');
    const lines = content.split('\n');

    // 行号引用
    if (reference.type === 'line' && reference.lineNumber) {
      const lineExists = reference.lineNumber <= lines.length;
      return {
        reference,
        exists: lineExists,
        error: lineExists ? undefined : `行号超出范围: ${reference.lineNumber} > ${lines.length}`,
      };
    }

    // 函数引用
    if (reference.type === 'function' && reference.functionName) {
      const funcName = reference.functionName;
      // 简单匹配：函数声明或函数表达式
      const funcPatterns = [
        new RegExp(`function\\s+${funcName}\\s*\\(`, 'g'),
        new RegExp(`const\\s+${funcName}\\s*=\\s*(?:async\\s*)?\\(?`, 'g'),
        new RegExp(`let\\s+${funcName}\\s*=\\s*(?:async\\s*)?\\(?`, 'g'),
        new RegExp(`var\\s+${funcName}\\s*=\\s*(?:async\\s*)?\\(?`, 'g'),
        new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${funcName}\\s*\\(`, 'g'),
        new RegExp(`def\\s+${funcName}\\s*\\(`, 'g'), // Python
      ];

      const found = funcPatterns.some(pattern => pattern.test(content));
      return {
        reference,
        exists: found,
        error: found ? undefined : `函数未找到: ${funcName}`,
      };
    }

    return { reference, exists: true };
  } catch (err) {
    logger.warn('Failed to read file for verification', {
      filePath: fullPath,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      reference,
      exists: false,
      error: `无法读取文件: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * 计算事实准确性分数
 */
export function calculateFactAccuracy(
  report: InvestigationReport,
  projectRoot: string,
): FactAccuracyResult {
  const logger = createLogger('fact-verifier');

  // 从报告各字段提取文本
  const textParts: string[] = [];

  // 根因分析描述
  for (const ca of report.rootCauseAnalysis || []) {
    textParts.push(ca.description || '');
  }

  // 解决方案描述和文件列表
  for (const sol of report.solutions || []) {
    textParts.push(sol.description || '');
    if (sol.files && sol.files.length > 0) {
      textParts.push(sol.files.join(' '));
    }
    textParts.push(sol.expectedChanges || '');
  }

  const fullText = textParts.join('\n');

  // 解析代码引用
  const references = parseCodeReferences(fullText);

  logger.debug('Fact accuracy analysis', {
    textLength: fullText.length,
    referenceCount: references.length,
    references: references.slice(0, 5).map(r => ({ type: r.type, filePath: r.filePath, rawText: r.rawText })),
  });

  if (references.length === 0) {
    // 无代码引用时，返回中性分数（不做验证）
    return {
      totalReferences: 0,
      validReferences: 0,
      score: 100, // 无引用默认满分
      details: [],
    };
  }

  // 验证每个引用
  const details: ReferenceVerification[] = [];
  let validCount = 0;

  for (const ref of references) {
    const result = verifyReference(ref, projectRoot);
    details.push(result);
    if (result.exists) {
      validCount++;
    }
  }

  // 计算分数
  const score = Math.round((validCount / references.length) * 100);

  logger.info('Fact accuracy result', {
    totalReferences: references.length,
    validReferences: validCount,
    score,
  });

  return {
    totalReferences: references.length,
    validReferences: validCount,
    score,
    details,
  };
}

/**
 * 批量验证报告中的代码引用
 */
export function verifyFactAccuracy(
  report: InvestigationReport,
  projectRoot: string,
): FactAccuracyResult {
  return calculateFactAccuracy(report, projectRoot);
}
