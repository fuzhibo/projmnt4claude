/**
 * investigation 模块单元测试
 *
 * 覆盖检查点 §3.1-§3.8:
 * - §3.1 类型系统
 * - §3.2 配置
 * - §3.3 报告格式
 * - §3.4 工具模块
 * - §3.5 输出模式
 * - §3.6 AI集成层
 * - §3.7 i18n
 * - §3.8 接口契约
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { createIsolatedTestEnv, type IsolatedTestEnv } from '../../test-env.js';

// ============================================================
// Mocks (hoisted)
// ============================================================

jest.mock('../../headless-agent.js', () => ({
  invokeAgent: jest.fn(),
}));

// ============================================================
// Imports
// ============================================================

import { invokeAgent } from '../../headless-agent.js';
const mockInvokeAgent = invokeAgent as jest.Mock;

import {
  // Types
  InvestigationReport,
  PREFIX_MAP,
  CheckpointPrefix,
  ReviewResult,
  SplitPlan,
  SplitReviewResult,
  OutputMode,
  InvestigationConfig,
  ValidationResult,
  // Functions
  generateReport,
  parseReport,
  extractDependencies,
  validateReport,
  VALIDATION_RULES,
  getRule,
  reviewReport,
  reviewWithRetry,
  shouldSplit,
  generateSplitPlan,
  reviewSplitPlan,
  executeSplit,
  callAI,
  callAIForJSON,
  loadInvestigationConfig,
  loadLanguageConfig,
} from '../index.js';

import { loadTemplate, renderTemplate, loadAndRenderTemplate, listTemplates } from '../../prompt-templates/loader.js';

// ============================================================
// Test Helpers
// ============================================================

function createValidReport(overrides: Partial<InvestigationReport> = {}): InvestigationReport {
  return {
    metadata: {
      requirementSource: '添加用户登录功能',
      investigationDate: '2026-05-27T10:00:00Z',
      investigationDir: 'investigation-login-feature',
      language: 'zh',
    },
    rootCauseAnalysis: [
      { id: 'CA-001', title: '缺少登录界面', description: '当前系统没有登录入口' },
    ],
    solutions: [
      { id: 'SOL-001', title: '创建登录页面', correspondsTo: 'CA-001', description: '实现登录表单', files: ['src/pages/login.tsx'], expectedChanges: '新增登录页面组件' },
    ],
    checkpoints: [
      { prefix: 'verify', description: '验证登录表单提交', belongsTo: 'SOL-001' },
      { prefix: 'test', description: '测试登录逻辑', belongsTo: 'SOL-001' },
    ],
    assessment: {
      complexity: 'medium',
      impactScope: '中等',
      estimatedMinutes: 60,
    },
    ...overrides,
  };
}

function createValidMarkdown(): string {
  return `# 调查报告

- **需求来源**: 添加用户登录功能
- **调查时间**: 2026-05-27T10:00:00Z
- **调查目录**: investigation-login-feature
- **语言**: zh

## 原因分析

### CA-001: 缺少登录界面

当前系统没有登录入口

## 解决方案

### SOL-001: 创建登录页面

- **对应原因**: CA-001
- **涉及文件**: src/pages/login.tsx
- **预期变更**: 新增登录页面组件

实现登录表单

## 检查点

- [verify] 验证登录表单提交 (→ SOL-001)
- [test] 测试登录逻辑 (→ SOL-001)

## 评估

- **复杂度**: medium
- **影响范围**: 中等
- **预估工时**: 60 分钟`;
}

function createSubReportMarkdown(): string {
  return `# 调查报告

- **需求来源**: 子需求描述
- **调查时间**: 2026-05-27T10:00:00Z
- **调查目录**: investigation-login-style
- **语言**: zh
- **父报告**: ../report.md
- **依赖子报告**: sub-01.md, sub-02.md

## 原因分析

### CA-001: 样式问题
描述内容

## 解决方案

### SOL-001: 修复样式
- **对应原因**: CA-001
- **涉及文件**: src/style.css
- **预期变更**: 样式调整

方案内容

## 检查点

- [verify] 验证样式 (→ SOL-001)

## 评估

- **复杂度**: low
- **影响范围**: 有限
- **预估工时**: 30 分钟`;
}

// ============================================================
// §3.1 类型系统测试
// ============================================================

describe('§3.1 类型系统', () => {
  describe('InvestigationReport 完整性', () => {
    it('应包含所有必填字段', () => {
      const report = createValidReport();

      expect(report.metadata).toBeDefined();
      expect(report.rootCauseAnalysis).toBeDefined();
      expect(report.solutions).toBeDefined();
      expect(report.checkpoints).toBeDefined();
      expect(report.assessment).toBeDefined();
    });

    it('metadata 应包含必要字段', () => {
      const report = createValidReport();
      const m = report.metadata;

      expect(m.requirementSource).toBeDefined();
      expect(m.investigationDate).toBeDefined();
      expect(m.investigationDir).toBeDefined();
      expect(m.language).toMatch(/^(zh|en)$/);
    });

    it('子报告应支持 parentReport 和 dependsOn', () => {
      const report = createValidReport({
        metadata: {
          ...createValidReport().metadata,
          parentReport: '../report.md',
          dependsOn: ['sub-01.md', 'sub-02.md'],
        },
      });

      expect(report.metadata.parentReport).toBe('../report.md');
      expect(report.metadata.dependsOn).toHaveLength(2);
    });
  });

  describe('PREFIX_MAP 5种前缀', () => {
    it('应包含所有标准前缀', () => {
      const prefixes = Object.keys(PREFIX_MAP);

      expect(prefixes).toContain('verify');
      expect(prefixes).toContain('test');
      expect(prefixes).toContain('review');
      expect(prefixes).toContain('implem');
      expect(prefixes).toContain('doc');
      expect(prefixes).toHaveLength(5);
    });

    it('每个前缀应有正确的 category/method/requiresHuman', () => {
      expect(PREFIX_MAP.verify).toEqual({ category: 'qa_verification', method: 'functional_test', requiresHuman: false });
      expect(PREFIX_MAP.test).toEqual({ category: 'qa_verification', method: 'unit_test', requiresHuman: false });
      expect(PREFIX_MAP.review).toEqual({ category: 'code_review', method: 'code_review', requiresHuman: true });
      expect(PREFIX_MAP.implem).toEqual({ category: 'implementation', method: 'automated', requiresHuman: false });
      expect(PREFIX_MAP.doc).toEqual({ category: 'documentation', method: 'automated', requiresHuman: false });
    });
  });

  describe('ReviewResult 三维度', () => {
    it('应包含 pass/scores/issues', () => {
      const result: ReviewResult = {
        pass: true,
        scores: {
          rootCauseAlignment: 85,
          solutionEffectiveness: 90,
          checkpointCompleteness: 80,
        },
        issues: [],
      };

      expect(result.pass).toBeDefined();
      expect(result.scores.rootCauseAlignment).toBeDefined();
      expect(result.scores.solutionEffectiveness).toBeDefined();
      expect(result.scores.checkpointCompleteness).toBeDefined();
      expect(result.issues).toBeDefined();
    });
  });

  describe('SplitPlan/SplitReviewResult 六维度', () => {
    it('SplitPlan 应包含 relationship/estimatedSize', () => {
      const plan: SplitPlan = {
        items: [
          { title: '子项1', relationship: 'parallel', scope: 'scope1', description: 'desc', estimatedSize: 20, dependsOn: [] },
        ],
      };

      expect(plan.items[0].relationship).toMatch(/^(parallel|hierarchical)$/);
      expect(typeof plan.items[0].estimatedSize).toBe('number');
    });

    it('SplitReviewResult 应包含六维度审核（含 antiPhaseSplitting）', () => {
      const result: SplitReviewResult = {
        pass: true,
        scores: {
          coverage: 85,
          boundaryClarity: 80,
          independence: 90,
          dependencyReasonability: 75,
          antiPhaseSplitting: 95,
          granularity: 85,
        },
        issues: [],
      };

      const dimensions = Object.keys(result.scores);
      expect(dimensions).toContain('coverage');
      expect(dimensions).toContain('boundaryClarity');
      expect(dimensions).toContain('independence');
      expect(dimensions).toContain('dependencyReasonability');
      expect(dimensions).toContain('antiPhaseSplitting');
      expect(dimensions).toContain('granularity');
      expect(dimensions).toHaveLength(6);
    });
  });
});

// ============================================================
// §3.2 配置测试
// ============================================================

describe('§3.2 配置', () => {
  let env: IsolatedTestEnv;

  beforeEach(async () => {
    env = await createIsolatedTestEnv();
  });

  afterEach(async () => {
    await env.cleanup();
  });

  describe('splitThreshold 读取', () => {
    it('应从 config.json 读取 splitThreshold', () => {
      const configPath = path.join(env.projectDir, 'config.json');
      fs.writeFileSync(configPath, JSON.stringify({
        investigation: { splitThreshold: 50, maxRetry: 5, outputDir: 'docs/custom' },
      }));

      const config = loadInvestigationConfig(env.tempDir);
      expect(config.splitThreshold).toBe(50);
    });

    it('config.json 缺失时应使用硬编码默认值 30KB', () => {
      const config = loadInvestigationConfig(env.tempDir);
      expect(config.splitThreshold).toBe(30);
    });

    it('CLI 参数优先级高于 config.json', () => {
      const configPath = path.join(env.projectDir, 'config.json');
      fs.writeFileSync(configPath, JSON.stringify({
        investigation: { splitThreshold: 50 },
      }));

      const config = loadInvestigationConfig(env.tempDir, 100);
      expect(config.splitThreshold).toBe(100);
    });
  });

  describe('语言配置', () => {
    it('应从 prompts.language 读取', () => {
      const configPath = path.join(env.projectDir, 'config.json');
      fs.writeFileSync(configPath, JSON.stringify({
        prompts: { language: 'en' },
      }));

      const lang = loadLanguageConfig(env.tempDir);
      expect(lang).toBe('en');
    });

    it('语言配置缺失时应回退到 zh', () => {
      const lang = loadLanguageConfig(env.tempDir);
      expect(lang).toBe('zh');
    });
  });
});

// ============================================================
// §3.3 报告格式测试
// ============================================================

describe('§3.3 报告格式', () => {
  describe('report-generator', () => {
    it('应生成包含5大章节的 markdown', () => {
      const report = createValidReport();
      const md = generateReport(report);

      expect(md).toContain('# 调查报告');
      expect(md).toContain('## 原因分析');
      expect(md).toContain('## 解决方案');
      expect(md).toContain('## 检查点');
      expect(md).toContain('## 评估');
    });

    it('CA/SOL 编号应正确对应', () => {
      const report = createValidReport();
      const md = generateReport(report);

      expect(md).toContain('CA-001');
      expect(md).toContain('SOL-001');
      expect(md).toContain('对应原因: CA-001');
    });

    it('子报告应包含父报告引用和依赖', () => {
      const report = createValidReport({
        metadata: {
          ...createValidReport().metadata,
          parentReport: '../report.md',
          dependsOn: ['sub-01.md'],
        },
      });
      const md = generateReport(report);

      expect(md).toContain('父报告: ../report.md');
      expect(md).toContain('依赖子报告: sub-01.md');
    });
  });

  describe('report-parser', () => {
    it('应解析完整报告（含 CA/SOL/检查点/评估）', () => {
      const md = createValidMarkdown();
      const report = parseReport(md);

      expect(report.metadata.requirementSource).toBe('添加用户登录功能');
      expect(report.rootCauseAnalysis).toHaveLength(1);
      expect(report.rootCauseAnalysis[0].id).toBe('CA-001');
      expect(report.solutions).toHaveLength(1);
      expect(report.solutions[0].id).toBe('SOL-001');
      expect(report.checkpoints).toHaveLength(2);
      expect(report.assessment.complexity).toBe('medium');
    });

    it('子报告依赖字段应正确提取', () => {
      const md = createSubReportMarkdown();
      const deps = extractDependencies(md);

      expect(deps).toHaveLength(2);
      expect(deps).toContain('sub-01.md');
      expect(deps).toContain('sub-02.md');
    });
  });
});

// ============================================================
// §3.4 工具模块测试
// ============================================================

describe('§3.4 工具模块', () => {
  describe('report-validator 八项规则', () => {
    it('有效报告应通过验证', () => {
      const report = createValidReport();
      const result = validateReport(report);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('缺少 metadata.requirementSource 应阻断', () => {
      const report = createValidReport({
        metadata: { ...createValidReport().metadata, requirementSource: '' },
      });
      const result = validateReport(report);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.rule === 'metadata-required')).toBe(true);
    });

    it('rootCauseAnalysis 为空应阻断', () => {
      const report = createValidReport({ rootCauseAnalysis: [] });
      const result = validateReport(report);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.rule === 'root-cause-non-empty')).toBe(true);
    });

    it('solutions 为空应阻断', () => {
      const report = createValidReport({ solutions: [] });
      const result = validateReport(report);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.rule === 'solution-non-empty')).toBe(true);
    });

    it('CA-SOL 对应关系错误应阻断', () => {
      const report = createValidReport({
        solutions: [{ ...createValidReport().solutions[0], correspondsTo: 'CA-999' }],
      });
      const result = validateReport(report);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.rule === 'ca-sol-correspondence')).toBe(true);
    });

    it('检查点为空应阻断', () => {
      const report = createValidReport({ checkpoints: [] });
      const result = validateReport(report);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.rule === 'checkpoint-prefix')).toBe(true);
    });

    it('检查点前缀不在 PREFIX_MAP 应警告', () => {
      const report = createValidReport({
        checkpoints: [{ prefix: 'invalid' as CheckpointPrefix, description: 'test', belongsTo: 'SOL-001' }],
      });
      const result = validateReport(report);

      expect(result.warnings.some(w => w.rule === 'checkpoint-prefix')).toBe(true);
    });

    it('assessment 缺失应警告', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const report = createValidReport({ assessment: undefined as any });
      const result = validateReport(report);

      expect(result.warnings.some(w => w.rule === 'assessment-required')).toBe(true);
    });

    it('ID 格式不正确应警告', () => {
      const report = createValidReport({
        rootCauseAnalysis: [{ id: 'CA-1', title: 'test', description: 'desc' }],
      });
      const result = validateReport(report);

      expect(result.warnings.some(w => w.rule === 'id-format')).toBe(true);
    });
  });

  describe('report-reviewer AI评审', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('reviewReport 应调用 AI 并返回 ReviewResult', async () => {
      mockInvokeAgent.mockResolvedValue({
        output: JSON.stringify({ pass: true, scores: { rootCauseAlignment: 85, solutionEffectiveness: 90, checkpointCompleteness: 80 }, issues: [] }),
        success: true,
        durationMs: 1000,
      });

      const result = await reviewReport('需求', createValidReport(), '/tmp', 'zh');

      expect(result.pass).toBe(true);
      expect(mockInvokeAgent).toHaveBeenCalled();
    });

    it('reviewWithRetry 应在失败时重试', async () => {
      mockInvokeAgent.mockResolvedValueOnce({
        output: JSON.stringify({ pass: false, scores: { rootCauseAlignment: 50, solutionEffectiveness: 60, checkpointCompleteness: 70 }, issues: [{ dimension: 'rootCauseAlignment', severity: 'critical', description: '问题', suggestion: '建议' }] }),
        success: true,
        durationMs: 500,
      });
      mockInvokeAgent.mockResolvedValueOnce({
        output: JSON.stringify({ pass: true, scores: { rootCauseAlignment: 85, solutionEffectiveness: 90, checkpointCompleteness: 80 }, issues: [] }),
        success: true,
        durationMs: 500,
      });

      const { review } = await reviewWithRetry('需求', createValidReport(), { cwd: '/tmp', lang: 'zh', maxRetry: 2 });

      expect(review.pass).toBe(true);
      expect(mockInvokeAgent).toHaveBeenCalledTimes(2);
    });

    it('达到 maxRetry 应抛出错误', async () => {
      mockInvokeAgent.mockResolvedValue({
        output: JSON.stringify({ pass: false, scores: { rootCauseAlignment: 50, solutionEffectiveness: 60, checkpointCompleteness: 70 }, issues: [{ dimension: 'rootCauseAlignment', severity: 'critical', description: '问题', suggestion: '建议' }] }),
        success: true,
        durationMs: 500,
      });

      await expect(reviewWithRetry('需求', createValidReport(), { cwd: '/tmp', lang: 'zh', maxRetry: 1 }))
        .rejects.toThrow(/failed after 1 retries/);
    });
  });

  describe('report-splitter', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('shouldSplit 应判断文件大小', async () => {
      const testFile = '/tmp/test-report.md';
      fs.writeFileSync(testFile, 'x'.repeat(40 * 1024)); // 40KB

      expect(shouldSplit(testFile, 30)).toBe(true);
      expect(shouldSplit(testFile, 50)).toBe(false);

      fs.unlinkSync(testFile);
    });

    it('generateSplitPlan 应返回 SplitPlan', async () => {
      mockInvokeAgent.mockResolvedValue({
        output: JSON.stringify({ items: [{ title: '子项', relationship: 'parallel', scope: 'scope', description: 'desc', estimatedSize: 20, dependsOn: [] }] }),
        success: true,
        durationMs: 500,
      });

      const plan = await generateSplitPlan(createValidReport(), '/tmp', 'zh');

      expect(plan.items).toHaveLength(1);
      expect(plan.items[0].relationship).toBe('parallel');
    });

    it('reviewSplitPlan 应返回六维度审核结果', async () => {
      mockInvokeAgent.mockResolvedValue({
        output: JSON.stringify({
          pass: true,
          scores: { coverage: 85, boundaryClarity: 80, independence: 90, dependencyReasonability: 75, antiPhaseSplitting: 95, granularity: 85 },
          issues: [],
        }),
        success: true,
        durationMs: 500,
      });

      const plan: SplitPlan = { items: [{ title: '子项', relationship: 'parallel', scope: 'scope', description: 'desc', estimatedSize: 20, dependsOn: [] }] };
      const result = await reviewSplitPlan(createValidReport(), plan, '/tmp', 'zh');

      expect(result.pass).toBe(true);
      expect(result.scores.antiPhaseSplitting).toBeDefined();
    });
  });
});

// ============================================================
// §3.5 输出模式测试
// ============================================================

describe('§3.5 输出模式', () => {
  describe('OutputMode 类型', () => {
    it('目录模式应包含 type: dir', () => {
      const mode: OutputMode = { type: 'dir', path: 'docs/investigation' };
      expect(mode.type).toBe('dir');
    });

    it('文件模式应包含 type: file', () => {
      const mode: OutputMode = { type: 'file', path: 'report.md' };
      expect(mode.type).toBe('file');
    });
  });
});

// ============================================================
// §3.6 AI集成层测试
// ============================================================

describe('§3.6 AI集成层', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('callAI', () => {
    it('应复用 invokeAgent', async () => {
      mockInvokeAgent.mockResolvedValue({ output: 'result', success: true, durationMs: 1000 });

      const result = await callAI({ prompt: 'test', cwd: '/tmp', outputFormat: 'text' });

      expect(result.success).toBe(true);
      expect(mockInvokeAgent).toHaveBeenCalled();
    });

    it('失败时应返回 success: false', async () => {
      mockInvokeAgent.mockRejectedValue(new Error('timeout'));

      const result = await callAI({ prompt: 'test', cwd: '/tmp', outputFormat: 'text' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('timeout');
    });
  });

  describe('callAIForJSON', () => {
    it('应自动解析 JSON 输出', async () => {
      mockInvokeAgent.mockResolvedValue({
        output: '```json\n{"key": "value"}\n```',
        success: true,
        durationMs: 500,
      });

      const result = await callAIForJSON<{ key: string }>({ prompt: 'test', cwd: '/tmp' });

      expect(result.key).toBe('value');
    });

    it('非 JSON 输出应抛出解析错误', async () => {
      mockInvokeAgent.mockResolvedValue({
        output: 'not json',
        success: true,
        durationMs: 500,
      });

      await expect(callAIForJSON({ prompt: 'test', cwd: '/tmp' }))
        .rejects.toThrow(/Failed to parse AI output as JSON/);
    });

    it('validator 应验证解析结果', async () => {
      mockInvokeAgent.mockResolvedValue({
        output: '{"pass": true, "scores": {"rootCauseAlignment": 85, "solutionEffectiveness": 90, "checkpointCompleteness": 80}, "issues": []}',
        success: true,
        durationMs: 500,
      });

      const result = await callAIForJSON<ReviewResult>(
        { prompt: 'test', cwd: '/tmp' },
        (data) => {
          if (typeof (data as ReviewResult).pass !== 'boolean') throw new Error('invalid');
          return data as ReviewResult;
        },
      );

      expect(result.pass).toBe(true);
    });
  });
});

// ============================================================
// §3.7 i18n 测试
// ============================================================

describe('§3.7 i18n', () => {
  describe('模板语言加载', () => {
    it('loadTemplate 应加载 zh 模板', () => {
      const template = loadTemplate('investigate', 'zh');
      expect(template).toContain('需求调查分析师');
    });

    it('loadTemplate 应加载 en 模板', () => {
      const template = loadTemplate('investigate', 'en');
      expect(template).toContain('requirement investigation analyst');
    });

    it('不支持的语言应抛出错误', () => {
      expect(() => loadTemplate('investigate', 'fr' as 'zh' | 'en'))
        .toThrow(/Unsupported language/);
    });

    it('不存在的模板应抛出错误', () => {
      expect(() => loadTemplate('nonexistent' as 'investigate', 'zh'))
        .toThrow(/not found/);
    });
  });

  describe('占位符替换', () => {
    it('renderTemplate 应替换所有 {paramName}', () => {
      const template = '{a} and {b}';
      const result = renderTemplate(template, { a: '1', b: '2' });
      expect(result).toBe('1 and 2');
    });

    it('未提供的占位符应保留原样', () => {
      const template = '{a} and {b}';
      const result = renderTemplate(template, { a: '1' });
      expect(result).toBe('1 and {b}');
    });

    it('loadAndRenderTemplate 应合并加载和渲染', () => {
      const result = loadAndRenderTemplate('investigate', { requirement: '登录功能', projectContext: 'Web项目' }, 'zh');
      expect(result).toContain('登录功能');
      expect(result).toContain('Web项目');
    });
  });

  describe('中英文模板参数一致性', () => {
    it('investigate 模板应包含相同占位符', () => {
      const zh = loadTemplate('investigate', 'zh');
      const en = loadTemplate('investigate', 'en');

      const zhParams = (zh.match(/\{(\w+)\}/g) || []).sort();
      const enParams = (en.match(/\{(\w+)\}/g) || []).sort();

      expect(zhParams).toEqual(enParams);
    });

    it('review 模板应包含相同占位符', () => {
      const zh = loadTemplate('review', 'zh');
      const en = loadTemplate('review', 'en');

      const zhParams = (zh.match(/\{(\w+)\}/g) || []).sort();
      const enParams = (en.match(/\{(\w+)\}/g) || []).sort();

      expect(zhParams).toEqual(enParams);
    });

    it('splitReview 模板应包含相同占位符', () => {
      const zh = loadTemplate('splitReview', 'zh');
      const en = loadTemplate('splitReview', 'en');

      const zhParams = (zh.match(/\{(\w+)\}/g) || []).sort();
      const enParams = (en.match(/\{(\w+)\}/g) || []).sort();

      expect(zhParams).toEqual(enParams);
    });
  });
});

// ============================================================
// §3.8 接口契约测试
// ============================================================

describe('§3.8 接口契约', () => {
  describe('validator 规则表', () => {
    it('VALIDATION_RULES 应包含八项规则', () => {
      expect(VALIDATION_RULES).toHaveLength(8);
    });

    it('规则表应两端一致（investigation/init action 定义）', () => {
      for (const rule of VALIDATION_RULES) {
        expect(rule.name).toBeDefined();
        expect(rule.condition).toBeDefined();
        expect(['block', 'warn']).toContain(rule.investigationAction);
        expect(['block', 'warn']).toContain(rule.initAction);
      }
    });

    it('getRule 应返回指定规则', () => {
      const rule = getRule('metadata-required');
      expect(rule?.name).toBe('metadata-required');
    });
  });

  describe('PREFIX_MAP 一致性', () => {
    it('应包含所有 CheckpointPrefix', () => {
      const prefixes: CheckpointPrefix[] = ['verify', 'test', 'review', 'implem', 'doc'];
      for (const p of prefixes) {
        expect(PREFIX_MAP[p]).toBeDefined();
      }
    });

    it('requiresHuman 标记应正确', () => {
      expect(PREFIX_MAP.review.requiresHuman).toBe(true);
      expect(PREFIX_MAP.verify.requiresHuman).toBe(false);
      expect(PREFIX_MAP.test.requiresHuman).toBe(false);
      expect(PREFIX_MAP.implem.requiresHuman).toBe(false);
      expect(PREFIX_MAP.doc.requiresHuman).toBe(false);
    });
  });

  describe('InvestigationReport 作为正式接口', () => {
    it('generator 和 parser 应互为逆操作', () => {
      const report = createValidReport();
      const md = generateReport(report);
      const parsed = parseReport(md);

      expect(parsed.metadata.requirementSource).toBe(report.metadata.requirementSource);
      expect(parsed.rootCauseAnalysis[0].id).toBe(report.rootCauseAnalysis[0].id);
      expect(parsed.solutions[0].id).toBe(report.solutions[0].id);
    });
  });
});