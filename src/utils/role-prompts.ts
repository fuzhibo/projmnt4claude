/**
 * 角色感知提示词模板
 *
 * 为不同专业角色提供定制化的提示词片段，
 * 被 buildDevPrompt / buildCodeReviewPrompt / buildQAPrompt 消费。
 */

import { getI18n, type Language } from '../i18n';
import type { RoleType, DevRoleTemplate, CodeReviewRoleTemplate, QARoleTemplate } from '../i18n';

export type { RoleType, DevRoleTemplate, CodeReviewRoleTemplate, QARoleTemplate };

/**
 * 将 recommendedRole 字符串规范化为 RoleType
 * 支持模糊匹配：'front-end' → 'frontend', 'sec' → 'security' 等
 */
export function normalizeRole(role?: string): RoleType | undefined {
  if (!role) return undefined;
  const lower = role.toLowerCase().replace(/[-_]/g, '');
  const mapping: Record<string, RoleType> = {
    frontend: 'frontend',
    front: 'frontend',
    fe: 'frontend',
    backend: 'backend',
    back: 'backend',
    be: 'backend',
    qa: 'qa',
    test: 'qa',
    tester: 'qa',
    architect: 'architect',
    arch: 'architect',
    security: 'security',
    sec: 'security',
    performance: 'performance',
    perf: 'performance',
    optimization: 'performance',
  };
  return mapping[lower];
}

/** 获取开发阶段角色模板 */
export function getDevRoleTemplate(role?: string, language?: Language): DevRoleTemplate {
  const i18n = getI18n(language);
  const normalized = normalizeRole(role);
  return normalized ? i18n.rolePrompts.dev[normalized] : i18n.rolePrompts.defaultDev;
}

/** 获取代码审核阶段角色模板 */
export function getCodeReviewRoleTemplate(role?: string, language?: Language): CodeReviewRoleTemplate {
  const i18n = getI18n(language);
  const normalized = normalizeRole(role);
  return normalized ? i18n.rolePrompts.codeReview[normalized] : i18n.rolePrompts.defaultCodeReview;
}

/** 获取 QA 阶段角色模板 */
export function getQARoleTemplate(role?: string, language?: Language): QARoleTemplate {
  const i18n = getI18n(language);
  const normalized = normalizeRole(role);
  return normalized ? i18n.rolePrompts.qa[normalized] : i18n.rolePrompts.defaultQA;
}
