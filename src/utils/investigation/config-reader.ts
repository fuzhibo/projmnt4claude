/**
 * Investigation 配置读取模块
 *
 * 从 config.json 读取 investigation 配置段，
 * 支持 CLI 参数优先级覆盖。
 */

import * as fs from 'fs';
import * as path from 'path';
import type { InvestigationConfig } from './types.js';

const DEFAULT_CONFIG: InvestigationConfig = {
  splitThreshold: 30,
  maxRetry: 3,
  outputDir: 'docs/investigation',
};

/**
 * 查找项目配置文件路径
 *
 * 查找顺序：
 * 1. .projmnt4claude/config.json
 * 2. 项目根目录 config.json（回退）
 */
function findConfigPath(cwd: string): string | null {
  // 查找 .projmnt4claude/config.json
  const projConfigPath = path.join(cwd, '.projmnt4claude', 'config.json');
  if (fs.existsSync(projConfigPath)) return projConfigPath;

  // 回退：项目根目录 config.json
  const rootConfigPath = path.join(cwd, 'config.json');
  if (fs.existsSync(rootConfigPath)) return rootConfigPath;

  return null;
}

/**
 * 加载 investigation 配置
 *
 * 优先级：
 * 1. CLI 参数（cliThreshold）
 * 2. config.json investigation.splitThreshold
 * 3. 硬编码默认值 30KB
 */
export function loadInvestigationConfig(cwd: string, cliThreshold?: number): InvestigationConfig {
  try {
    const configPath = findConfigPath(cwd);
    if (configPath && fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(content);
      const invConfig = config?.investigation;

      if (invConfig) {
        return {
          splitThreshold: cliThreshold ?? invConfig.splitThreshold ?? DEFAULT_CONFIG.splitThreshold,
          maxRetry: invConfig.maxRetry ?? DEFAULT_CONFIG.maxRetry,
          outputDir: invConfig.outputDir ?? DEFAULT_CONFIG.outputDir,
        };
      }
    }
  } catch {
    // 配置读取失败，使用默认值
  }

  return {
    ...DEFAULT_CONFIG,
    splitThreshold: cliThreshold ?? DEFAULT_CONFIG.splitThreshold,
  };
}

/**
 * 加载 prompts.language 配置
 *
 * 优先级：
 * 1. config.json → prompts.language
 * 2. 系统环境 LANG → 推断
 * 3. 默认 → 'zh'
 */
export function loadLanguageConfig(cwd: string): 'zh' | 'en' {
  try {
    const configPath = findConfigPath(cwd);
    if (configPath && fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(content);
      const lang = config?.prompts?.language;
      if (lang === 'en' || lang === 'zh') {
        return lang;
      }
    }
  } catch {
    // 配置读取失败，使用默认值
  }

  // 尝试从系统环境推断
  const envLang = process.env.LANG || process.env.LC_ALL || '';
  if (envLang.toLowerCase().includes('zh')) {
    return 'zh';
  }

  return 'zh';
}

/**
 * 获取默认配置（供测试和参考）
 */
export function getDefaultConfig(): InvestigationConfig {
  return { ...DEFAULT_CONFIG };
}

// ============================================================
// customRequirements 注入辅助函数（SOL-004）
// ============================================================

/**
 * i18n 前置引导语模板
 * 空值时不会生成，有值时自动添加，避免空洞章节
 */
const GUIDANCE_TEMPLATES: Record<string, Record<string, string>> = {
  zh: {
    investigate: '## 用户定制要求\n请在调查过程中遵循以下定制要求：',
    review: '## 用户定制要求\n请在评审过程中遵循以下定制要求：',
    investigateWithFeedback: '## 用户定制要求\n请在修正过程中遵循以下定制要求：',
    split: '## 用户定制要求\n请在拆分过程中遵循以下定制要求：',
    splitReview: '## 用户定制要求\n请在审核过程中遵循以下定制要求：',
  },
  en: {
    investigate: '## Custom Requirements\nPlease follow the custom requirements below during investigation:',
    review: '## Custom Requirements\nPlease follow the custom requirements below during review:',
    investigateWithFeedback: '## Custom Requirements\nPlease follow the custom requirements below during revision:',
    split: '## Custom Requirements\nPlease follow the custom requirements below during splitting:',
    splitReview: '## Custom Requirements\nPlease follow the custom requirements below during split review:',
  },
};

/** investigation-requirement 阶段名称 */
export type InvestigationPhase = 'investigate' | 'review' | 'investigateWithFeedback' | 'split' | 'splitReview';

/**
 * 加载 investigation-requirement 的 customRequirements 配置
 */
export function loadCustomRequirements(cwd: string): Record<InvestigationPhase, string> {
  const configPath = findConfigPath(cwd);
  if (configPath && fs.existsSync(configPath)) {
    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(content);
      const customReqs = config?.prompts?.customRequirements || {};
      return {
        investigate: customReqs.investigate || '',
        review: customReqs.review || '',
        investigateWithFeedback: customReqs.investigateWithFeedback || '',
        split: customReqs.split || '',
        splitReview: customReqs.splitReview || '',
      };
    } catch {
      // 配置读取失败，返回空值
    }
  }
  return { investigate: '', review: '', investigateWithFeedback: '', split: '', splitReview: '' };
}

/**
 * 格式化 customRequirements 为模板参数
 *
 * 设计要点：
 * 1. 空值时返回空字符串，模板中不产生空洞章节
 * 2. 有值时自动添加前置引导语，AI 明确知道如何处理
 * 3. 支持 i18n 多语言和阶段差异化引导语
 *
 * @param text - 用户配置的定制要求内容
 * @param phase - 阶段名称（investigate, review, 等）
 * @param lang - 语言（zh, en）
 * @returns 格式化后的内容，空值时返回空字符串
 */
export function formatCustomRequirements(text: string, phase: InvestigationPhase, lang: 'zh' | 'en'): string {
  if (!text || text.trim() === '') return '';
  const guidance = GUIDANCE_TEMPLATES[lang]?.[phase] || '';
  return `${guidance}\n${text}\n`;
}