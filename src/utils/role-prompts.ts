/**
 * 角色感知提示词模板
 *
 * 为不同专业角色提供定制化的提示词片段，
 * 被 buildDevPrompt / buildCodeReviewPrompt / buildQAPrompt 消费。
 */

import { getI18n, type Language } from '../i18n';
import type { RoleType, DevRoleTemplate, CodeReviewRoleTemplate, QARoleTemplate } from '../i18n';

export type { RoleType, DevRoleTemplate, CodeReviewRoleTemplate, QARoleTemplate };

// 测试注入点：允许测试通过全局变量注入 mock
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getTestMock(name: string): any {
  return (globalThis as any).__PROJMNT4CLAUDE_TEST_MOCKS__?.[name];
}

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
  // 测试注入点
  const testMock = getTestMock('getDevRoleTemplate');
  if (testMock) {
    return testMock(role, language);
  }

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
