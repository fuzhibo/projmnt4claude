/**
 * Investigation 提示词模板加载器
 *
 * 支持按语言加载模板 + Mustache 风格占位符替换
 * 支持 investigation 和 init-requirement 两套模板
 */

import { investigationTemplates as zhTemplates } from './i18n/zh.js';
import { investigationTemplates as enTemplates } from './i18n/en.js';

// init-requirement 模板使用动态导入，避免测试时拉入庞大的模板字符串导致 OOM
let zhInitTemplates: Record<string, string> | undefined;
let enInitTemplates: Record<string, string> | undefined;

async function getZhInitTemplates(): Promise<Record<string, string>> {
  if (!zhInitTemplates) {
    const mod = await import('./i18n/init-requirement-zh.js');
    zhInitTemplates = mod.initRequirementTemplates;
  }
  return zhInitTemplates;
}

async function getEnInitTemplates(): Promise<Record<string, string>> {
  if (!enInitTemplates) {
    const mod = await import('./i18n/init-requirement-en.js');
    enInitTemplates = mod.initRequirementTemplates;
  }
  return enInitTemplates;
}

const baseRegistry: Record<string, Record<string, Record<string, string>>> = {
  zh: { ...zhTemplates },
  en: { ...enTemplates },
};

/** 支持的模板名称 */
export type InvestigationTemplateName = 'investigate' | 'review' | 'investigateWithFeedback' | 'split' | 'splitReview';

/** init-requirement 模板名称 */
export type InitRequirementTemplateName = 'reportToTask' | 'taskFix' | 'aiAlignmentCheck';

/** 所有模板名称 */
export type TemplateName = InvestigationTemplateName | InitRequirementTemplateName;

/**
 * 获取完整模板注册表（包含 init-requirement 模板）
 */
async function getFullRegistry(lang: 'zh' | 'en'): Promise<Record<string, string>> {
  const base = baseRegistry[lang];
  if (!base) {
    throw new Error(`Unsupported language: ${lang}. Supported: zh, en`);
  }
  const initTemplates = lang === 'zh' ? await getZhInitTemplates() : await getEnInitTemplates();
  return { ...base, ...initTemplates };
}

/**
 * 加载指定语言的模板
 */
export async function loadTemplate(name: TemplateName, lang: 'zh' | 'en' = 'zh'): Promise<string> {
  const templates = await getFullRegistry(lang);
  const template = templates[name];
  if (!template) {
    throw new Error(`Template "${name}" not found for language "${lang}". Available: ${Object.keys(templates).join(', ')}`);
  }
  return template;
}

/**
 * 同步加载 investigation 模板（不含 init-requirement，避免 OOM）
 */
export function loadInvestigationTemplateSync(name: InvestigationTemplateName, lang: 'zh' | 'en' = 'zh'): string {
  const templates = baseRegistry[lang];
  if (!templates) {
    throw new Error(`Unsupported language: ${lang}. Supported: zh, en`);
  }
  const template = templates[name];
  if (!template) {
    throw new Error(`Template "${name}" not found for language "${lang}". Available: ${Object.keys(templates).join(', ')}`);
  }
  return template;
}

/**
 * 渲染模板：替换 {placeholder} 风格的占位符
 */
export function renderTemplate(template: string, params: Record<string, string>): string {
  const result = template.replace(/\{(\w+)\}/g, (match, key: string) => {
    if (key in params) {
      return params[key];
    }
    return match;
  });

  // 检测未替换的占位符并输出警告
  const unmatched = result.match(/\{(\w+)\}/g);
  if (unmatched) {
    const keys = [...new Set(unmatched.map(m => m.slice(1, -1)))];
    // eslint-disable-next-line no-console
    console.warn(`[renderTemplate] 以下占位符未替换: ${keys.join(', ')}`);
  }

  return result;
}

/**
 * 便捷方法：加载并渲染模板
 */
export async function loadAndRenderTemplate(
  name: TemplateName,
  params: Record<string, string>,
  lang: 'zh' | 'en' = 'zh',
): Promise<string> {
  const template = await loadTemplate(name, lang);
  return renderTemplate(template, params);
}

/**
 * 列出指定语言可用的模板名称
 */
export async function listTemplates(lang: 'zh' | 'en' = 'zh'): Promise<string[]> {
  const templates = await getFullRegistry(lang);
  return Object.keys(templates);
}

/**
 * 同步列出 investigation 模板名称（不含 init-requirement）
 */
export function listInvestigationTemplatesSync(lang: 'zh' | 'en' = 'zh'): string[] {
  const templates = baseRegistry[lang];
  return templates ? Object.keys(templates) : [];
}
