/**
 * Investigation 提示词模板加载器
 *
 * 支持按语言加载模板 + Mustache 风格占位符替换
 * 支持 investigation 和 init-requirement 两套模板
 */

import { investigationTemplates as zhTemplates } from './i18n/zh.js';
import { investigationTemplates as enTemplates } from './i18n/en.js';
import { createLogger } from '../logger.js';

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

const baseRegistry: Record<string, Record<string, string>> = {
  zh: { ...zhTemplates },
  en: { ...enTemplates },
};

/** 支持的模板名称 */
export type InvestigationTemplateName = 'investigate' | 'review' | 'investigateWithFeedback' | 'split' | 'splitReview' | 'retryPrompt';

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

/** renderTemplate 错误处理模式 */
export type RenderTemplateMode = 'strict' | 'lenient' | 'auto-fill';

/** renderTemplate 选项 */
export interface RenderTemplateOptions {
  /** 错误处理模式：strict 抛错、lenient 仅警告（默认）、auto-fill 用默认值替换 */
  mode?: RenderTemplateMode;
  /** auto-fill 模式下，自动替换占位符的默认值映射 */
  autoFillDefaults?: Record<string, string>;
  /** 检测到未替换占位符时的回调通知 */
  onUnreplaced?: (placeholderNames: string[]) => void;
}

/**
 * 渲染模板：替换 {placeholder} 风格的占位符
 * LOG-01: 模板渲染日志增强
 *
 * @param template - 模板字符串，包含 {placeholder} 风格的占位符
 * @param params - 占位符替换值映射
 * @param options - 渲染选项（模式、默认值、回调）
 * @returns 渲染后的字符串
 * @throws {Error} strict 模式下检测到未替换占位符时抛出
 */
export function renderTemplate(
  template: string,
  params: Record<string, string>,
  options?: RenderTemplateOptions,
): string {
  const logger = createLogger('prompt-templates');
  const {
    mode = 'lenient',
    autoFillDefaults = {},
    onUnreplaced,
  } = options ?? {};

  // LOG-01: 记录模板渲染输入
  logger.debug('renderTemplate input', {
    templateLength: template.length,
    paramsKeys: Object.keys(params),
    paramsPreview: Object.fromEntries(
      Object.entries(params).map(([k, v]) => [k, v.substring(0, 100)])
    ),
  });

  const result = template.replace(/\{(\w+)\}/g, (match, key: string): string => {
    if (key in params) {
      return params[key] ?? match;
    }
    return match;
  });

  // 检测未替换的占位符
  const unmatched = result.match(/\{(\w+)\}/g);
  if (unmatched) {
    const placeholderNames = [...new Set(unmatched.map(m => m.slice(1, -1)))];

    // LOG-01: 检测到未替换占位符
    logger.warn('renderTemplate has unreplaced placeholders', {
      placeholders: placeholderNames,
    });

    // 回调通知
    onUnreplaced?.(placeholderNames);

    if (mode === 'strict') {
      throw new Error(`[renderTemplate] 未替换占位符: ${placeholderNames.join(', ')}`);
    } else if (mode === 'auto-fill') {
      let filled = result;
      for (const name of placeholderNames) {
        const defaultValue = autoFillDefaults[name] ?? `[待填充:${name}]`;
        filled = filled.replace(new RegExp(`\\{${name}\\}`, 'g'), defaultValue);
      }
      // eslint-disable-next-line no-console
      console.warn(`[renderTemplate] 自动替换未替换占位符: ${placeholderNames.join(', ')}`);
      return filled;
    } else {
      // lenient 模式：仅警告（保持向后兼容）
      // eslint-disable-next-line no-console
      console.warn(`[renderTemplate] 以下占位符未替换: ${placeholderNames.join(', ')}`);
    }
  }

  return result;
}

/**
 * 验证模板中是否存在未定义的占位符（预检查机制）
 *
 * 用途：开发时手动调用，检测模板示例占位符与真实占位符冲突。
 * 此函数检测 {xxx} 格式占位符，与 renderTemplate 使用相同正则。
 * 生产环境不自动调用，避免性能开销。
 *
 * @param template - 模板字符串
 * @param knownPlaceholders - 已知的合法占位符列表
 * @param templateName - 模板名称（用于日志）
 */
export function validateTemplate(
  template: string,
  knownPlaceholders: string[],
  templateName: string = 'unknown',
): void {
  const logger = createLogger('prompt-templates');
  const allPlaceholders = template.match(/\{(\w+)\}/g) || [];
  const unmatched = [...new Set(allPlaceholders.map(m => m.slice(1, -1)))].filter(
    key => !knownPlaceholders.includes(key),
  );

  if (unmatched.length > 0) {
    logger.warn(`[Template Warning] 模板 "${templateName}" 中存在未定义的占位符: ${unmatched.join(', ')}`);
  }
}

/**
 * 便捷方法：加载并渲染模板
 */
export async function loadAndRenderTemplate(
  name: TemplateName,
  params: Record<string, string>,
  lang: 'zh' | 'en' = 'zh',
  options?: RenderTemplateOptions,
): Promise<string> {
  const template = await loadTemplate(name, lang);
  return renderTemplate(template, params, options);
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
