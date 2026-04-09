/**
 * ai-prompt.ts (prompt-templates.ts) 单元测试
 *
 * 测试重点:
 * - resolveTemplate 模板插值
 * - loadPromptTemplate 模板加载
 * - 默认模板常量
 * - 模板注册表
 */

import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
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
import * as configModule from '../commands/config.js';

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
  let readConfigSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    readConfigSpy = spyOn(configModule, 'readConfig');
  });

  afterEach(() => {
    readConfigSpy.mockRestore();
  });

  describe('正常输入处理', () => {
    it('应该返回默认开发模板', () => {
      readConfigSpy.mockReturnValue(null);
      const result = loadPromptTemplate('dev', '/test');
      expect(result).toBe(DEFAULT_DEV_TEMPLATE);
    });

    it('应该返回默认 QA 模板', () => {
      readConfigSpy.mockReturnValue(null);
      const result = loadPromptTemplate('qa', '/test');
      expect(result).toBe(DEFAULT_QA_TEMPLATE);
    });

    it('应该返回默认代码审核模板', () => {
      readConfigSpy.mockReturnValue(null);
      const result = loadPromptTemplate('codeReview', '/test');
      expect(result).toBe(DEFAULT_CODE_REVIEW_TEMPLATE);
    });

    it('应该返回默认评估模板', () => {
      readConfigSpy.mockReturnValue(null);
      const result = loadPromptTemplate('evaluation', '/test');
      expect(result).toBe(DEFAULT_EVALUATION_TEMPLATE);
    });

    it('应该返回默认需求模板', () => {
      readConfigSpy.mockReturnValue(null);
      const result = loadPromptTemplate('requirement', '/test');
      expect(result).toBe(DEFAULT_REQUIREMENT_TEMPLATE);
    });

    it('应该返回默认检查点模板', () => {
      readConfigSpy.mockReturnValue(null);
      const result = loadPromptTemplate('checkpoints', '/test');
      expect(result).toBe(DEFAULT_CHECKPOINTS_TEMPLATE);
    });

    it('应该返回默认质量模板', () => {
      readConfigSpy.mockReturnValue(null);
      const result = loadPromptTemplate('quality', '/test');
      expect(result).toBe(DEFAULT_QUALITY_TEMPLATE);
    });

    it('应该返回默认重复检测模板', () => {
      readConfigSpy.mockReturnValue(null);
      const result = loadPromptTemplate('duplicates', '/test');
      expect(result).toBe(DEFAULT_DUPLICATES_TEMPLATE);
    });

    it('应该返回默认过期评估模板', () => {
      readConfigSpy.mockReturnValue(null);
      const result = loadPromptTemplate('staleness', '/test');
      expect(result).toBe(DEFAULT_STALENESS_TEMPLATE);
    });

    it('应该返回默认 Bug 报告模板', () => {
      readConfigSpy.mockReturnValue(null);
      const result = loadPromptTemplate('bugReport', '/test');
      expect(result).toBe(DEFAULT_BUG_REPORT_TEMPLATE);
    });

    it('应该返回默认语义依赖模板', () => {
      readConfigSpy.mockReturnValue(null);
      const result = loadPromptTemplate('semanticDependency', '/test');
      expect(result).toBe(DEFAULT_SEMANTIC_DEPENDENCY_TEMPLATE);
    });

    it('当配置存在自定义模板时应该返回自定义模板', () => {
      const customTemplate = 'Custom template for {taskId}';
      readConfigSpy.mockReturnValue({
        prompts: {
          dev: customTemplate,
        },
      });
      const result = loadPromptTemplate('dev', '/test');
      expect(result).toBe(customTemplate);
    });
  });

  describe('边界条件处理', () => {
    it('当没有提供 cwd 时应该返回默认模板', () => {
      const result = loadPromptTemplate('dev');
      expect(result).toBe(DEFAULT_DEV_TEMPLATE);
    });

    it('当配置存在但没有 prompts 节时应该返回默认模板', () => {
      readConfigSpy.mockReturnValue({});
      const result = loadPromptTemplate('dev', '/test');
      expect(result).toBe(DEFAULT_DEV_TEMPLATE);
    });

    it('当 prompts 节存在但请求模板不存在时应该返回默认模板', () => {
      readConfigSpy.mockReturnValue({
        prompts: {
          qa: 'Custom QA template',
        },
      });
      const result = loadPromptTemplate('dev', '/test');
      expect(result).toBe(DEFAULT_DEV_TEMPLATE);
    });

    it('当自定义模板为空字符串时应该返回空字符串', () => {
      readConfigSpy.mockReturnValue({
        prompts: {
          dev: '',
        },
      });
      const result = loadPromptTemplate('dev', '/test');
      expect(result).toBe('');
    });
  });
});

describe('DEFAULT_TEMPLATES 注册表', () => {
  it('应该包含所有 11 个模板', () => {
    expect(Object.keys(DEFAULT_TEMPLATES)).toHaveLength(11);
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
});

describe('PROMPT_TEMPLATE_NAMES', () => {
  it('应该包含所有 11 个模板名称', () => {
    expect(PROMPT_TEMPLATE_NAMES).toHaveLength(11);
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
    ];
    expect(PROMPT_TEMPLATE_NAMES).toEqual(expected);
  });

  it('模板名称应该与 DEFAULT_TEMPLATES 的键匹配', () => {
    const templateKeys = Object.keys(DEFAULT_TEMPLATES) as PromptTemplateName[];
    expect(PROMPT_TEMPLATE_NAMES.sort()).toEqual(templateKeys.sort());
  });
});

describe('默认模板内容验证', () => {
  it('DEFAULT_DEV_TEMPLATE 应该包含关键占位符', () => {
    expect(DEFAULT_DEV_TEMPLATE).toContain('{title}');
    expect(DEFAULT_DEV_TEMPLATE).toContain('{taskId}');
    expect(DEFAULT_DEV_TEMPLATE).toContain('{type}');
    expect(DEFAULT_DEV_TEMPLATE).toContain('{priority}');
  });

  it('DEFAULT_QA_TEMPLATE 应该包含 VERDICT 标记', () => {
    expect(DEFAULT_QA_TEMPLATE).toContain('VERDICT: PASS');
    expect(DEFAULT_QA_TEMPLATE).toContain('VERDICT: NOPASS');
  });

  it('DEFAULT_CODE_REVIEW_TEMPLATE 应该包含审核要求', () => {
    expect(DEFAULT_CODE_REVIEW_TEMPLATE).toContain('代码审核');
    expect(DEFAULT_CODE_REVIEW_TEMPLATE).toContain('VERDICT: PASS');
  });

  it('DEFAULT_EVALUATION_TEMPLATE 应该包含评估格式要求', () => {
    expect(DEFAULT_EVALUATION_TEMPLATE).toContain('EVALUATION_RESULT: PASS');
    expect(DEFAULT_EVALUATION_TEMPLATE).toContain('EVALUATION_RESULT: NOPASS');
  });

  it('DEFAULT_REQUIREMENT_TEMPLATE 应该要求 JSON 输出', () => {
    expect(DEFAULT_REQUIREMENT_TEMPLATE).toContain('JSON');
    expect(DEFAULT_REQUIREMENT_TEMPLATE).toContain('title');
    expect(DEFAULT_REQUIREMENT_TEMPLATE).toContain('description');
  });

  it('DEFAULT_CHECKPOINTS_TEMPLATE 应该要求动词开头', () => {
    expect(DEFAULT_CHECKPOINTS_TEMPLATE).toContain('动词开头');
    expect(DEFAULT_CHECKPOINTS_TEMPLATE).toContain('checkpoints');
  });

  it('DEFAULT_QUALITY_TEMPLATE 应该包含评分字段', () => {
    expect(DEFAULT_QUALITY_TEMPLATE).toContain('score');
    expect(DEFAULT_QUALITY_TEMPLATE).toContain('issues');
  });

  it('DEFAULT_DUPLICATES_TEMPLATE 应该包含重复检测字段', () => {
    expect(DEFAULT_DUPLICATES_TEMPLATE).toContain('duplicates');
    expect(DEFAULT_DUPLICATES_TEMPLATE).toContain('similarity');
  });

  it('DEFAULT_STALENESS_TEMPLATE 应该包含过期评估字段', () => {
    expect(DEFAULT_STALENESS_TEMPLATE).toContain('isStale');
    expect(DEFAULT_STALENESS_TEMPLATE).toContain('stalenessScore');
  });

  it('DEFAULT_BUG_REPORT_TEMPLATE 应该包含 Bug 分析字段', () => {
    expect(DEFAULT_BUG_REPORT_TEMPLATE).toContain('rootCause');
    expect(DEFAULT_BUG_REPORT_TEMPLATE).toContain('impactScope');
  });

  it('DEFAULT_SEMANTIC_DEPENDENCY_TEMPLATE 应该包含依赖字段', () => {
    expect(DEFAULT_SEMANTIC_DEPENDENCY_TEMPLATE).toContain('dependencies');
    expect(DEFAULT_SEMANTIC_DEPENDENCY_TEMPLATE).toContain('taskId');
    expect(DEFAULT_SEMANTIC_DEPENDENCY_TEMPLATE).toContain('depTaskId');
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

  it('PromptTemplate 应该是字符串类型', () => {
    const template: PromptTemplate = 'Test template';
    expect(typeof template).toBe('string');
  });

  it('PromptTemplateName 应该接受所有有效值', () => {
    const names: PromptTemplateName[] = PROMPT_TEMPLATE_NAMES;
    expect(names.length).toBe(11);
  });
});
