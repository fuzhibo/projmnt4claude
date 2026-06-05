/**
 * Investigation 提示词模板加载器
 *
 * 支持按语言加载模板 + Mustache 风格占位符替换
 * 支持 investigation 和 init-requirement 两套模板
 */

import { investigationTemplates as zhTemplates } from './i18n/zh.js';
import { investigationTemplates as enTemplates } from './i18n/en.js';
import { initRequirementTemplates as zhInitTemplates } from './i18n/init-requirement-zh.js';
import { initRequirementTemplates as enInitTemplates } from './i18n/init-requirement-en.js';

const templateRegistry: Record<string, Record<string, Record<string, string>>> = {
  zh: { ...zhTemplates, ...zhInitTemplates },
  en: { ...enTemplates, ...enInitTemplates },
};

/** 支持的模板名称 */
export type InvestigationTemplateName = 'investigate' | 'review' | 'investigateWithFeedback' | 'split' | 'splitReview';

/** init-requirement 模板名称 */
export type InitRequirementTemplateName = 'reportToTask' | 'taskFix' | 'aiAlignmentCheck';

/** 所有模板名称 */
export type TemplateName = InvestigationTemplateName | InitRequirementTemplateName;

/**
 * 加载指定语言的模板
 */
export function loadTemplate(name: TemplateName, lang: 'zh' | 'en' = 'zh'): string {
  const templates = templateRegistry[lang];
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
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    if (key in params) {
      return params[key];
    }
    return match;
  });
}

/**
 * 便捷方法：加载并渲染模板
 */
export function loadAndRenderTemplate(
  name: TemplateName,
  params: Record<string, string>,
  lang: 'zh' | 'en' = 'zh',
): string {
  const template = loadTemplate(name, lang);
  return renderTemplate(template, params);
}

/**
 * 列出指定语言可用的模板名称
 */
export function listTemplates(lang: 'zh' | 'en' = 'zh'): string[] {
  const templates = templateRegistry[lang];
  return templates ? Object.keys(templates) : [];
}