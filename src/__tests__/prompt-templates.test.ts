/**
 * prompt-templates.ts 单元测试
 *
 * 覆盖: loadCustomRequirements 函数
 */

import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import {
  createIsolatedTestEnv,
  type IsolatedTestEnv,
} from '../utils/test-env.js';
import {
  loadCustomRequirements,
  type CustomRequirementsPhase,
  DEFAULT_DEV_TEMPLATE,
  DEFAULT_CODE_REVIEW_TEMPLATE,
  DEFAULT_QA_TEMPLATE,
  DEFAULT_EVALUATION_TEMPLATE,
} from '../utils/prompt-templates.js';
import type { ProjectConfig } from '../types/config.js';
import { DEFAULT_LOGGING, DEFAULT_AI, DEFAULT_TRAINING } from '../types/config.js';

// ── 测试辅助 ──────────────────────────────────────────────
function baseConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    projectName: 'test-project',
    createdAt: '2026-01-01',
    branchPrefix: 'feature/',
    defaultPriority: 'medium',
    ...overrides,
  };
}

/** 创建测试配置文件 */
function createTestConfigFile(projectDir: string, config: ProjectConfig): void {
  const configPath = path.join(projectDir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

// ── loadCustomRequirements 测试 ───────────────────────────────────
describe('loadCustomRequirements', () => {
  let env: IsolatedTestEnv;

  beforeEach(async () => {
    env = await createIsolatedTestEnv({ autoInit: false });
  });

  afterEach(() => {
    env.cleanup();
  });

  test('无配置时返回空字符串', () => {
    createTestConfigFile(env.projectDir, baseConfig());
    const result = loadCustomRequirements('dev', env.tempDir);
    expect(result).toBe('');
  });

  test('无 prompts 配置时返回空字符串', () => {
    createTestConfigFile(env.projectDir, baseConfig());
    const result = loadCustomRequirements('dev', env.tempDir);
    expect(result).toBe('');
  });

  test('无 customRequirements 配置时返回空字符串', () => {
    createTestConfigFile(env.projectDir, baseConfig({ prompts: {} }));
    const result = loadCustomRequirements('dev', env.tempDir);
    expect(result).toBe('');
  });

  test('有值-zh: 返回带中文标题的段落', () => {
    createTestConfigFile(env.projectDir, baseConfig({
      language: 'zh',
      prompts: { customRequirements: { dev: '关注性能优化' } },
    }));
    const result = loadCustomRequirements('dev', env.tempDir);
    expect(result).toContain('## 定制需求');
    expect(result).toContain('关注性能优化');
  });

  test('有值-en: 返回带英文标题的段落', () => {
    createTestConfigFile(env.projectDir, baseConfig({
      prompts: { language: 'en', customRequirements: { dev: 'Focus on performance' } },
    }));
    const result = loadCustomRequirements('dev', env.tempDir);
    expect(result).toContain('## Custom Requirements');
    expect(result).toContain('Focus on performance');
  });

  test('无值: 返回空字符串', () => {
    createTestConfigFile(env.projectDir, baseConfig({
      prompts: { customRequirements: { dev: '' } },
    }));
    const result = loadCustomRequirements('dev', env.tempDir);
    expect(result).toBe('');
  });

  test('空内容: 返回空字符串', () => {
    createTestConfigFile(env.projectDir, baseConfig({
      prompts: { customRequirements: { dev: '   ' } },
    }));
    const result = loadCustomRequirements('dev', env.tempDir);
    expect(result).toBe('');
  });

  test('语言优先级: 参数 > prompts.language > config.language > en', () => {
    // config.language = zh, prompts.language = en, 参数 = zh
    createTestConfigFile(env.projectDir, baseConfig({
      language: 'zh',
      prompts: { language: 'en', customRequirements: { dev: 'Test' } },
    }));
    const result = loadCustomRequirements('dev', env.tempDir, 'zh');
    expect(result).toContain('## 定制需求');
  });

  test('语言优先级: prompts.language > config.language', () => {
    // config.language = zh, prompts.language = en
    createTestConfigFile(env.projectDir, baseConfig({
      language: 'zh',
      prompts: { language: 'en', customRequirements: { dev: 'Test' } },
    }));
    const result = loadCustomRequirements('dev', env.tempDir);
    expect(result).toContain('## Custom Requirements');
  });

  test('语言优先级: config.language > en', () => {
    // config.language = zh, 无 prompts.language
    createTestConfigFile(env.projectDir, baseConfig({
      language: 'zh',
      prompts: { customRequirements: { dev: 'Test' } },
    }));
    const result = loadCustomRequirements('dev', env.tempDir);
    expect(result).toContain('## 定制需求');
  });

  test('不同阶段返回不同内容', () => {
    createTestConfigFile(env.projectDir, baseConfig({
      prompts: {
        customRequirements: {
          dev: 'Dev requirement',
          codeReview: 'Code review requirement',
          qa: 'QA requirement',
          evaluation: 'Evaluation requirement',
        },
      },
    }));

    expect(loadCustomRequirements('dev', env.tempDir)).toContain('Dev requirement');
    expect(loadCustomRequirements('codeReview', env.tempDir)).toContain('Code review requirement');
    expect(loadCustomRequirements('qa', env.tempDir)).toContain('QA requirement');
    expect(loadCustomRequirements('evaluation', env.tempDir)).toContain('Evaluation requirement');
  });

  test('内容被 trim 处理', () => {
    createTestConfigFile(env.projectDir, baseConfig({
      prompts: { customRequirements: { dev: '  内容前后有空格  ' } },
    }));
    const result = loadCustomRequirements('dev', env.tempDir);
    expect(result).toContain('内容前后有空格');
    expect(result).not.toContain('  内容前后有空格  ');
  });
});

// ── i18n Template Alignment 测试 ───────────────────────────────────
describe('i18n Template Alignment', () => {
  const templates = [
    { name: 'DEV', template: DEFAULT_DEV_TEMPLATE },
    { name: 'CODE_REVIEW', template: DEFAULT_CODE_REVIEW_TEMPLATE },
    { name: 'QA', template: DEFAULT_QA_TEMPLATE },
    { name: 'EVALUATION', template: DEFAULT_EVALUATION_TEMPLATE },
  ];

  describe('变量数量对齐', () => {
    for (const { name, template } of templates) {
      test(`${name} 模板 zh/en 变量数量一致`, () => {
        const zhVars = new Set(template.zh.match(/\{\w+\}/g) || []);
        const enVars = new Set(template.en.match(/\{\w+\}/g) || []);
        expect(zhVars.size).toBe(enVars.size);
        expect(zhVars).toEqual(enVars);
      });
    }
  });

  describe('h2/h3 标题数量对齐', () => {
    for (const { name, template } of templates) {
      test(`${name} 模板 zh/en h2 标题数量一致`, () => {
        const zhH2 = (template.zh.match(/^## /gm) || []).length;
        const enH2 = (template.en.match(/^## /gm) || []).length;
        expect(zhH2).toBe(enH2);
      });

      test(`${name} 模板 zh/en h3 标题数量一致`, () => {
        const zhH3 = (template.zh.match(/^### /gm) || []).length;
        const enH3 = (template.en.match(/^### /gm) || []).length;
        expect(zhH3).toBe(enH3);
      });
    }
  });

  describe('关键变量存在性', () => {
    for (const { name, template } of templates) {
      test(`${name} 模板 zh/en 包含 roleDeclaration`, () => {
        expect(template.zh).toContain('{roleDeclaration}');
        expect(template.en).toContain('{roleDeclaration}');
      });

      test(`${name} 模板 zh/en 包含 customRequirements`, () => {
        expect(template.zh).toContain('{customRequirements}');
        expect(template.en).toContain('{customRequirements}');
      });
    }
  });

  describe('roleDeclaration 位置验证', () => {
    test('DEV 模板 roleDeclaration 位于 ## 指示 之后', () => {
      // zh: roleDeclaration 应在 ## 指示 之后
      expect(DEFAULT_DEV_TEMPLATE.zh).toMatch(/## 指示\n\n\{roleDeclaration\}/);
      // en: roleDeclaration 应在 ## Instructions 之后
      expect(DEFAULT_DEV_TEMPLATE.en).toMatch(/## Instructions\n\n\{roleDeclaration\}/);
    });

    test('CODE_REVIEW 模板 roleDeclaration 位于文档开头', () => {
      expect(DEFAULT_CODE_REVIEW_TEMPLATE.zh).toMatch(/^\{roleDeclaration\}/);
      expect(DEFAULT_CODE_REVIEW_TEMPLATE.en).toMatch(/^\{roleDeclaration\}/);
    });

    test('QA 模板 roleDeclaration 位于文档开头', () => {
      expect(DEFAULT_QA_TEMPLATE.zh).toMatch(/^\{roleDeclaration\}/);
      expect(DEFAULT_QA_TEMPLATE.en).toMatch(/^\{roleDeclaration\}/);
    });

    test('EVALUATION 模板 roleDeclaration 位于文档开头', () => {
      // 注意：EVALUATION 模板当前使用角色描述文本而非 roleDeclaration 变量
      // 此测试验证模板结构，如果模板被修改为使用 roleDeclaration，此测试应通过
      // 当前状态：EVALUATION 模板没有 roleDeclaration 变量
      expect(DEFAULT_EVALUATION_TEMPLATE.zh).toMatch(/^\{roleDeclaration\}/);
      expect(DEFAULT_EVALUATION_TEMPLATE.en).toMatch(/^\{roleDeclaration\}/);
    });
  });
});
