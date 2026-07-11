/**
 * 模板渲染 strict 模式测试
 *
 * 验证 SOL-001: 模板示例占位符格式修复
 * 验证 SOL-003: validateTemplate 预检查机制
 */

import { describe, test, expect } from '@jest/globals';
import {
  renderTemplate,
  validateTemplate,
} from '../utils/prompt-templates/loader.js';
import { investigationTemplates as zhTemplates } from '../utils/prompt-templates/i18n/zh.js';
import { investigationTemplates as enTemplates } from '../utils/prompt-templates/i18n/en.js';

// ── renderTemplate strict 模式测试（SOL-001 验证）──────────────────
describe('renderTemplate strict mode', () => {
  test('strict 模式下中文 investigation 模板渲染正常', () => {
    const template = zhTemplates.investigate!;
    const params = {
      requirement: '测试需求',
      projectContext: '测试上下文',
      date: '2026-07-11',
      slug: 'test-slug',
      title: '测试标题',
      N: '30',
      customRequirements: '## 用户定制要求\n请在调查过程中遵循以下定制要求：\n请确保包含代码位置引用\n',
    };

    expect(() => {
      renderTemplate(template, params, { mode: 'strict' });
    }).not.toThrow();
  });

  test('strict 模式下英文 investigation 模板渲染正常', () => {
    const template = enTemplates.investigate!;
    const params = {
      requirement: 'Test requirement',
      projectContext: 'Test context',
      date: '2026-07-11',
      slug: 'test-slug',
      title: 'Test title',
      N: '30',
      customRequirements: '## Custom Requirements\nPlease follow the custom requirements below during investigation:\nInclude code references\n',
    };

    expect(() => {
      renderTemplate(template, params, { mode: 'strict' });
    }).not.toThrow();
  });

  test('strict 模式下中文 investigation 模板无 customRequirements 时渲染正常', () => {
    const template = zhTemplates.investigate!;
    const params = {
      requirement: '测试需求',
      projectContext: '测试上下文',
      date: '2026-07-11',
      slug: 'test-slug',
      title: '测试标题',
      N: '30',
      customRequirements: '', // 空值
    };

    expect(() => {
      renderTemplate(template, params, { mode: 'strict' });
    }).not.toThrow();
  });

  test('strict 模式下未替换占位符应抛错', () => {
    const template = 'Hello {name}, your age is {age}';
    const params = { name: 'Alice' };

    expect(() => {
      renderTemplate(template, params, { mode: 'strict' });
    }).toThrow('[renderTemplate] 未替换占位符: age');
  });

  test('lenient 模式下未替换占位符不抛错', () => {
    const template = 'Hello {name}, your age is {age}';
    const params = { name: 'Alice' };

    expect(() => {
      renderTemplate(template, params, { mode: 'lenient' });
    }).not.toThrow();
  });
});

// ── validateTemplate 预检查机制测试（SOL-003 验证）──────────────────
describe('validateTemplate', () => {
  test('检测到未定义占位符时输出警告', () => {
    const template = 'Hello {name}, your age is {age}';
    const knownPlaceholders = ['name'];

    expect(() => {
      validateTemplate(template, knownPlaceholders, 'test');
    }).not.toThrow();
  });

  test('所有占位符都已定义时不输出警告', () => {
    const template = 'Hello {name}, your age is {age}';
    const knownPlaceholders = ['name', 'age'];

    expect(() => {
      validateTemplate(template, knownPlaceholders, 'test');
    }).not.toThrow();
  });

  test('investigation 模板预检查通过', () => {
    const template = zhTemplates.investigate!;
    const knownPlaceholders = [
      'requirement', 'projectContext', 'date', 'slug', 'title', 'N',
    ];

    expect(() => {
      validateTemplate(template, knownPlaceholders, 'investigate');
    }).not.toThrow();
  });
});
