/**
 * ai-prompt.ts (prompt-templates.ts) 单元测试
 *
 * 测试重点:
 * - resolveTemplate 模板插值
 * - loadPromptTemplate 模板加载
 * - 默认模板常量
 * - 模板注册表
 *
 * 迁移说明:
 * - 使用 createIsolatedTestEnv 创建隔离测试环境
 * - 直接操作文件系统进行测试（创建实际的 config.json）
 * - 不再使用 spyOn mock readConfig
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import {
  resolveTemplate,
  loadPromptTemplate,
  type TemplateVariables,
  type PromptTemplate,
  type PromptTemplateName,
  PROMPT_TEMPLATE_NAMES,
  DEFAULT_TEMPLATES,
  DEFAULT_DEV_TEMPLATE,
  DEFAULT_CODE_REVIEW_TEMPLATE,
  DEFAULT_QA_TEMPLATE,
  DEFAULT_EVALUATION_TEMPLATE,
  DEFAULT_REQUIREMENT_TEMPLATE,
  DEFAULT_CHECKPOINTS_TEMPLATE,
  DEFAULT_QUALITY_TEMPLATE,
  DEFAULT_DUPLICATES_TEMPLATE,
  DEFAULT_STALENESS_TEMPLATE,
  DEFAULT_BUG_REPORT_TEMPLATE,
  DEFAULT_SEMANTIC_DEPENDENCY_TEMPLATE,
} from '../utils/prompt-templates.js';
import {
  createIsolatedTestEnv,
  type IsolatedTestEnv,
} from '../utils/test-env.js';

// ── 测试辅助函数 ──────────────────────────────────────────────

/**
 * 创建测试配置文件
 * 在项目根目录下的 .projmnt4claude 目录中创建 config.json
 */
function createTestConfig(projectDir: string, config: Record<string, unknown>): void {
  const configPath = path.join(projectDir, '.projmnt4claude', 'config.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

describe('resolveTemplate', () => {
  describe('正常输入处理', () => {
    it('应该正确替换单个变量', () => {
      const template = 'Hello, {name}!';
      const result = resolveTemplate(template, { name: 'World' });
      expect(result).toBe('Hello, World!');
    });

    it('应该正确替换多个变量', () => {
      const template = '{greeting}, {name}! You have {count} messages.';
      const result = resolveTemplate(template, {
        greeting: 'Hello',
        name: 'Alice',
        count: 5,
      });
      expect(result).toBe('Hello, Alice! You have 5 messages.');
    });

    it('应该支持数字类型的变量值', () => {
      const template = 'Score: {score}, Rank: {rank}';
      const result = resolveTemplate(template, { score: 95.5, rank: 1 });
      expect(result).toBe('Score: 95.5, Rank: 1');
    });

    it('应该支持空字符串值', () => {
      const template = 'Start{empty}End';
      const result = resolveTemplate(template, { empty: '' });
      expect(result).toBe('StartEnd');
    });
  });

  describe('边界条件处理', () => {
    it('应该保留未提供的变量占位符', () => {
      const template = 'Hello, {name}! Your code is {code}.';
      const result = resolveTemplate(template, { name: 'World' });
      expect(result).toBe('Hello, World! Your code is {code}.');
    });

    it('应该处理没有变量的模板', () => {
      const template = 'No variables here';
      const result = resolveTemplate(template, { name: 'test' });
      expect(result).toBe('No variables here');
    });

    it('应该处理空模板字符串', () => {
      const result = resolveTemplate('', { name: 'test' });
      expect(result).toBe('');
    });

    it('应该处理只有占位符的模板', () => {
      const template = '{var}';
      const result = resolveTemplate(template, { var: 'value' });
      expect(result).toBe('value');
    });

    it('应该处理重复出现的变量', () => {
      const template = '{name} says hello to {name}';
      const result = resolveTemplate(template, { name: 'Alice' });
      expect(result).toBe('Alice says hello to Alice');
    });

    it('应该正确将 undefined 视为未提供变量', () => {
      const template = 'Value: {val}';
      const result = resolveTemplate(template, { val: undefined });
      expect(result).toBe('Value: {val}');
    });

    it('应该正确处理值为 null 的情况', () => {
      const template = 'Value: {val}';
      const result = resolveTemplate(template, { val: null as unknown as undefined });
      expect(result).toBe('Value: {val}');
    });
  });

  describe('异常输入处理', () => {
    it('应该处理特殊字符在变量值中', () => {
      const template = 'Message: {msg}';
      const result = resolveTemplate(template, { msg: '<script>alert("xss")</script>' });
      expect(result).toBe('Message: <script>alert("xss")</script>');
    });

    it('应该处理换行符在变量值中', () => {
      const template = 'Content: {content}';
      const result = resolveTemplate(template, { content: 'line1\nline2\nline3' });
      expect(result).toBe('Content: line1\nline2\nline3');
    });

    it('应该处理包含大括号的变量值', () => {
      const template = 'Code: {code}';
      const result = resolveTemplate(template, { code: 'const x = { a: 1 }' });
      expect(result).toBe('Code: const x = { a: 1 }');
    });

    it('应该处理空对象变量', () => {
      const template = 'Hello, {name}!';
      const result = resolveTemplate(template, {});
      expect(result).toBe('Hello, {name}!');
    });
  });
});

describe('loadPromptTemplate', () => {
  let env: IsolatedTestEnv;

  beforeEach(async () => {
    env = await createIsolatedTestEnv();
  });

  afterEach(() => {
    env.cleanup();
  });

  describe('正常输入处理', () => {
    it('应该返回默认开发模板的英文版本', () => {
      // 无配置文件时返回默认模板
      const result = loadPromptTemplate('dev', env.tempDir);
      expect(result).toEqual(DEFAULT_DEV_TEMPLATE.en);
    });

    it('应该返回默认 QA 模板的英文版本', () => {
      const result = loadPromptTemplate('qa', env.tempDir);
      expect(result).toEqual(DEFAULT_QA_TEMPLATE.en);
    });

    it('应该返回默认代码审核模板的英文版本', () => {
      const result = loadPromptTemplate('codeReview', env.tempDir);
      expect(result).toEqual(DEFAULT_CODE_REVIEW_TEMPLATE.en);
    });

    it('应该返回默认评估模板的英文版本', () => {
      const result = loadPromptTemplate('evaluation', env.tempDir);
      expect(result).toEqual(DEFAULT_EVALUATION_TEMPLATE.en);
    });

    it('应该返回默认需求模板的英文版本', () => {
      const result = loadPromptTemplate('requirement', env.tempDir);
      expect(result).toEqual(DEFAULT_REQUIREMENT_TEMPLATE.en);
    });

    it('应该返回默认检查点模板的英文版本', () => {
      const result = loadPromptTemplate('checkpoints', env.tempDir);
      expect(result).toEqual(DEFAULT_CHECKPOINTS_TEMPLATE.en);
    });

    it('应该返回默认质量模板的英文版本', () => {
      const result = loadPromptTemplate('quality', env.tempDir);
      expect(result).toEqual(DEFAULT_QUALITY_TEMPLATE.en);
    });

    it('应该返回默认重复检测模板的英文版本', () => {
      const result = loadPromptTemplate('duplicates', env.tempDir);
      expect(result).toEqual(DEFAULT_DUPLICATES_TEMPLATE.en);
    });

    it('应该返回默认过期评估模板的英文版本', () => {
      const result = loadPromptTemplate('staleness', env.tempDir);
      expect(result).toEqual(DEFAULT_STALENESS_TEMPLATE.en);
    });

    it('应该返回默认 Bug 报告模板的英文版本', () => {
      const result = loadPromptTemplate('bugReport', env.tempDir);
      expect(result).toEqual(DEFAULT_BUG_REPORT_TEMPLATE.en);
    });

    it('应该返回默认语义依赖模板的英文版本', () => {
      const result = loadPromptTemplate('semanticDependency', env.tempDir);
      expect(result).toEqual(DEFAULT_SEMANTIC_DEPENDENCY_TEMPLATE.en);
    });

    it('当配置指定中文语言时应该返回中文模板', () => {
      createTestConfig(env.tempDir, {
        projectName: 'test',
        language: 'zh',
      });
      const result = loadPromptTemplate('dev', env.tempDir);
      expect(result).toEqual(DEFAULT_DEV_TEMPLATE.zh);
    });

    it('当配置指定英文语言时应该返回英文模板', () => {
      createTestConfig(env.tempDir, {
        projectName: 'test',
        language: 'en',
      });
      const result = loadPromptTemplate('dev', env.tempDir);
      expect(result).toEqual(DEFAULT_DEV_TEMPLATE.en);
    });

    it('当配置存在自定义模板时应该返回自定义模板', () => {
      const customTemplate = 'Custom template for {taskId}';
      createTestConfig(env.tempDir, {
        projectName: 'test',
        prompts: {
          dev: customTemplate,
        },
      });
      const result = loadPromptTemplate('dev', env.tempDir);
      expect(result).toEqual(customTemplate);
    });
  });

  describe('边界条件处理', () => {
    it('当没有提供 cwd 时应该返回默认英文模板', () => {
      // 无 cwd 时使用 process.cwd()，但由于 mock 了 isInitialized 返回 true
      // 这里测试的是函数的默认行为
      const result = loadPromptTemplate('dev');
      expect(result).toEqual(DEFAULT_DEV_TEMPLATE.en);
    });

    it('当配置存在但没有 prompts 节时应该返回默认模板', () => {
      createTestConfig(env.tempDir, {
        projectName: 'test',
      });
      const result = loadPromptTemplate('dev', env.tempDir);
      expect(result).toEqual(DEFAULT_DEV_TEMPLATE.en);
    });

    it('当 prompts 节存在但请求模板不存在时应该返回默认模板', () => {
      createTestConfig(env.tempDir, {
        projectName: 'test',
        prompts: {
          qa: 'Custom QA template',
        },
      });
      const result = loadPromptTemplate('dev', env.tempDir);
      expect(result).toEqual(DEFAULT_DEV_TEMPLATE.en);
    });

    it('当自定义模板为空字符串时应该返回空字符串', () => {
      createTestConfig(env.tempDir, {
        projectName: 'test',
        prompts: {
          dev: '',
        },
      });
      const result = loadPromptTemplate('dev', env.tempDir);
      expect(result).toBe('');
    });

    it('应该支持通过参数指定语言', () => {
      // 无配置文件
      const resultZh = loadPromptTemplate('dev', env.tempDir, 'zh');
      expect(resultZh).toEqual(DEFAULT_DEV_TEMPLATE.zh);

      const resultEn = loadPromptTemplate('dev', env.tempDir, 'en');
      expect(resultEn).toEqual(DEFAULT_DEV_TEMPLATE.en);
    });
  });
});

describe('DEFAULT_TEMPLATES 注册表', () => {
  it('应该包含所有 12 个模板', () => {
    expect(Object.keys(DEFAULT_TEMPLATES)).toHaveLength(12);
  });

  it('应该包含 dev 模板', () => {
    expect(DEFAULT_TEMPLATES.dev).toBe(DEFAULT_DEV_TEMPLATE);
  });

  it('应该包含 codeReview 模板', () => {
    expect(DEFAULT_TEMPLATES.codeReview).toBe(DEFAULT_CODE_REVIEW_TEMPLATE);
  });

  it('应该包含 qa 模板', () => {
    expect(DEFAULT_TEMPLATES.qa).toBe(DEFAULT_QA_TEMPLATE);
  });

  it('应该包含 evaluation 模板', () => {
    expect(DEFAULT_TEMPLATES.evaluation).toBe(DEFAULT_EVALUATION_TEMPLATE);
  });

  it('应该包含 requirement 模板', () => {
    expect(DEFAULT_TEMPLATES.requirement).toBe(DEFAULT_REQUIREMENT_TEMPLATE);
  });

  it('应该包含 checkpoints 模板', () => {
    expect(DEFAULT_TEMPLATES.checkpoints).toBe(DEFAULT_CHECKPOINTS_TEMPLATE);
  });

  it('应该包含 quality 模板', () => {
    expect(DEFAULT_TEMPLATES.quality).toBe(DEFAULT_QUALITY_TEMPLATE);
  });

  it('应该包含 duplicates 模板', () => {
    expect(DEFAULT_TEMPLATES.duplicates).toBe(DEFAULT_DUPLICATES_TEMPLATE);
  });

  it('应该包含 staleness 模板', () => {
    expect(DEFAULT_TEMPLATES.staleness).toBe(DEFAULT_STALENESS_TEMPLATE);
  });

  it('应该包含 bugReport 模板', () => {
    expect(DEFAULT_TEMPLATES.bugReport).toBe(DEFAULT_BUG_REPORT_TEMPLATE);
  });

  it('应该包含 semanticDependency 模板', () => {
    expect(DEFAULT_TEMPLATES.semanticDependency).toBe(DEFAULT_SEMANTIC_DEPENDENCY_TEMPLATE);
  });

  it('应该包含 decomposition 模板', () => {
    expect(DEFAULT_TEMPLATES.decomposition).toBeDefined();
  });
});

describe('PROMPT_TEMPLATE_NAMES', () => {
  it('应该包含所有 12 个模板名称', () => {
    expect(PROMPT_TEMPLATE_NAMES).toHaveLength(12);
  });

  it('应该包含所有预期的模板名称', () => {
    const expected: PromptTemplateName[] = [
      'dev',
      'codeReview',
      'qa',
      'evaluation',
      'requirement',
      'checkpoints',
      'quality',
      'duplicates',
      'staleness',
      'bugReport',
      'semanticDependency',
      'decomposition',
    ];
    expect(PROMPT_TEMPLATE_NAMES).toEqual(expected);
  });

  it('模板名称应该与 DEFAULT_TEMPLATES 的键匹配', () => {
    const templateKeys = Object.keys(DEFAULT_TEMPLATES) as PromptTemplateName[];
    expect(PROMPT_TEMPLATE_NAMES.sort()).toEqual(templateKeys.sort());
  });
});

describe('默认模板内容验证', () => {
  it('DEFAULT_DEV_TEMPLATE 应该包含中英文版本和关键占位符', () => {
    expect(DEFAULT_DEV_TEMPLATE.zh).toContain('{title}');
    expect(DEFAULT_DEV_TEMPLATE.zh).toContain('{taskId}');
    expect(DEFAULT_DEV_TEMPLATE.zh).toContain('{type}');
    expect(DEFAULT_DEV_TEMPLATE.zh).toContain('{priority}');
    expect(DEFAULT_DEV_TEMPLATE.en).toContain('{title}');
    expect(DEFAULT_DEV_TEMPLATE.en).toContain('{taskId}');
    expect(DEFAULT_DEV_TEMPLATE.en).toContain('{type}');
    expect(DEFAULT_DEV_TEMPLATE.en).toContain('{priority}');
  });

  it('DEFAULT_QA_TEMPLATE 应该包含中英文版本和 VERDICT 标记', () => {
    expect(DEFAULT_QA_TEMPLATE.zh).toContain('VERDICT: PASS');
    expect(DEFAULT_QA_TEMPLATE.zh).toContain('VERDICT: NOPASS');
    expect(DEFAULT_QA_TEMPLATE.en).toContain('VERDICT: PASS');
    expect(DEFAULT_QA_TEMPLATE.en).toContain('VERDICT: NOPASS');
  });

  it('DEFAULT_CODE_REVIEW_TEMPLATE 应该包含中英文版本和审核要求', () => {
    expect(DEFAULT_CODE_REVIEW_TEMPLATE.zh).toContain('代码审核');
    expect(DEFAULT_CODE_REVIEW_TEMPLATE.zh).toContain('VERDICT: PASS');
    expect(DEFAULT_CODE_REVIEW_TEMPLATE.en).toContain('Code Review');
    expect(DEFAULT_CODE_REVIEW_TEMPLATE.en).toContain('VERDICT: PASS');
  });

  it('DEFAULT_EVALUATION_TEMPLATE 应该包含中英文版本和评估格式要求', () => {
    expect(DEFAULT_EVALUATION_TEMPLATE.zh).toContain('EVALUATION_RESULT: PASS');
    expect(DEFAULT_EVALUATION_TEMPLATE.zh).toContain('EVALUATION_RESULT: NOPASS');
    expect(DEFAULT_EVALUATION_TEMPLATE.en).toContain('EVALUATION_RESULT: PASS');
    expect(DEFAULT_EVALUATION_TEMPLATE.en).toContain('EVALUATION_RESULT: NOPASS');
  });

  it('DEFAULT_REQUIREMENT_TEMPLATE 应该包含中英文版本和 JSON 输出要求', () => {
    expect(DEFAULT_REQUIREMENT_TEMPLATE.zh).toContain('JSON');
    expect(DEFAULT_REQUIREMENT_TEMPLATE.zh).toContain('title');
    expect(DEFAULT_REQUIREMENT_TEMPLATE.zh).toContain('description');
    expect(DEFAULT_REQUIREMENT_TEMPLATE.en).toContain('JSON');
    expect(DEFAULT_REQUIREMENT_TEMPLATE.en).toContain('title');
    expect(DEFAULT_REQUIREMENT_TEMPLATE.en).toContain('description');
  });

  it('DEFAULT_CHECKPOINTS_TEMPLATE 应该包含中英文版本和动词开头要求', () => {
    expect(DEFAULT_CHECKPOINTS_TEMPLATE.zh).toContain('动词开头');
    expect(DEFAULT_CHECKPOINTS_TEMPLATE.zh).toContain('checkpoints');
    expect(DEFAULT_CHECKPOINTS_TEMPLATE.en).toContain('starting with verb');
    expect(DEFAULT_CHECKPOINTS_TEMPLATE.en).toContain('checkpoints');
  });

  it('DEFAULT_QUALITY_TEMPLATE 应该包含中英文版本和评分字段', () => {
    expect(DEFAULT_QUALITY_TEMPLATE.zh).toContain('score');
    expect(DEFAULT_QUALITY_TEMPLATE.zh).toContain('issues');
    expect(DEFAULT_QUALITY_TEMPLATE.en).toContain('score');
    expect(DEFAULT_QUALITY_TEMPLATE.en).toContain('issues');
  });

  it('DEFAULT_DUPLICATES_TEMPLATE 应该包含中英文版本和重复检测字段', () => {
    expect(DEFAULT_DUPLICATES_TEMPLATE.zh).toContain('duplicates');
    expect(DEFAULT_DUPLICATES_TEMPLATE.zh).toContain('similarity');
    expect(DEFAULT_DUPLICATES_TEMPLATE.en).toContain('duplicates');
    expect(DEFAULT_DUPLICATES_TEMPLATE.en).toContain('similarity');
  });

  it('DEFAULT_STALENESS_TEMPLATE 应该包含中英文版本和过期评估字段', () => {
    expect(DEFAULT_STALENESS_TEMPLATE.zh).toContain('isStale');
    expect(DEFAULT_STALENESS_TEMPLATE.zh).toContain('stalenessScore');
    expect(DEFAULT_STALENESS_TEMPLATE.en).toContain('isStale');
    expect(DEFAULT_STALENESS_TEMPLATE.en).toContain('stalenessScore');
  });

  it('DEFAULT_BUG_REPORT_TEMPLATE 应该包含中英文版本和 Bug 分析字段', () => {
    expect(DEFAULT_BUG_REPORT_TEMPLATE.zh).toContain('rootCause');
    expect(DEFAULT_BUG_REPORT_TEMPLATE.zh).toContain('impactScope');
    expect(DEFAULT_BUG_REPORT_TEMPLATE.en).toContain('rootCause');
    expect(DEFAULT_BUG_REPORT_TEMPLATE.en).toContain('impactScope');
  });

  it('DEFAULT_SEMANTIC_DEPENDENCY_TEMPLATE 应该包含中英文版本和依赖字段', () => {
    expect(DEFAULT_SEMANTIC_DEPENDENCY_TEMPLATE.zh).toContain('dependencies');
    expect(DEFAULT_SEMANTIC_DEPENDENCY_TEMPLATE.zh).toContain('taskId');
    expect(DEFAULT_SEMANTIC_DEPENDENCY_TEMPLATE.zh).toContain('depTaskId');
    expect(DEFAULT_SEMANTIC_DEPENDENCY_TEMPLATE.en).toContain('dependencies');
    expect(DEFAULT_SEMANTIC_DEPENDENCY_TEMPLATE.en).toContain('taskId');
    expect(DEFAULT_SEMANTIC_DEPENDENCY_TEMPLATE.en).toContain('depTaskId');
  });
});

describe('TypeScript 类型', () => {
  it('TemplateVariables 应该接受字符串和数字值', () => {
    const vars: TemplateVariables = {
      str: 'string',
      num: 42,
      undef: undefined,
    };
    expect(vars.str).toBe('string');
    expect(vars.num).toBe(42);
    expect(vars.undef).toBeUndefined();
  });

  it('PromptTemplate 应该是 Record<Language, string> 类型', () => {
    const template: PromptTemplate = {
      zh: '中文模板',
      en: 'English template',
    };
    expect(template.zh).toBe('中文模板');
    expect(template.en).toBe('English template');
  });

  it('PromptTemplateName 应该接受所有有效值', () => {
    const names: PromptTemplateName[] = PROMPT_TEMPLATE_NAMES;
    expect(names.length).toBe(12);
  });
});
