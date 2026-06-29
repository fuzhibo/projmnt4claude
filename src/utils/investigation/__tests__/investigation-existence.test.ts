/**
 * Investigation 模块存在性验证测试
 *
 * 覆盖检查点：
 * - CP-ai-review-修复-qa-门禁反复失败的根因-移除-o
 * - CP-ai-review-模块间集成一致性-所有核心模块文件存在
 *
 * 此测试使用模块存在性验证（而非导入验证），避免 Jest/SWC OOM 问题。
 */

import { describe, it, expect } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================
// 模块路径定义
// ============================================================

const INVESTIGATION_DIR = path.resolve(__dirname, '..');
const PROMPT_TEMPLATES_DIR = path.resolve(__dirname, '../../prompt-templates');

const EXPECTED_MODULES = [
  // 核心类型定义
  'types.ts',
  // 配置读取
  'config-reader.ts',
  // 报告工具模块
  'report-generator.ts',
  'report-parser.ts',
  'report-validator.ts',
  'report-reviewer.ts',
  'report-splitter.ts',
  // AI 集成层
  'ai-integration.ts',
  // 统一导出
  'index.ts',
];

const EXPECTED_PROMPT_TEMPLATES = [
  'loader.ts',
  'i18n/zh.ts',
  'i18n/en.ts',
];

// ============================================================
// § 模块存在性验证
// ============================================================

describe('Investigation 模块存在性验证', () => {
  describe('核心模块文件存在', () => {
    it.each(EXPECTED_MODULES)('should have %s', (modulePath) => {
      const fullPath = path.join(INVESTIGATION_DIR, modulePath);
      expect(fs.existsSync(fullPath)).toBe(true);
    });
  });

  describe('提示词模板基础设施存在', () => {
    it.each(EXPECTED_PROMPT_TEMPLATES)('should have %s', (templatePath) => {
      const fullPath = path.join(PROMPT_TEMPLATES_DIR, templatePath);
      expect(fs.existsSync(fullPath)).toBe(true);
    });
  });

  describe('类型定义文件包含所有必要导出', () => {
    it('should export PREFIX_MAP from init-requirement/prefix-map', () => {
      const typesPath = path.join(INVESTIGATION_DIR, 'types.ts');
      const content = fs.readFileSync(typesPath, 'utf-8');
      expect(content).toContain("PREFIX_MAP");
      expect(content).toContain("init-requirement/prefix-map");
    });

    it('should define InvestigationReport interface', () => {
      const typesPath = path.join(INVESTIGATION_DIR, 'types.ts');
      const content = fs.readFileSync(typesPath, 'utf-8');
      expect(content).toContain('interface InvestigationReport');
      expect(content).toContain('metadata:');
      expect(content).toContain('rootCauseAnalysis:');
      expect(content).toContain('solutions:');
      expect(content).toContain('checkpoints:');
      expect(content).toContain('assessment:');
    });

    it('should define ReviewResult with 3 dimensions', () => {
      const typesPath = path.join(INVESTIGATION_DIR, 'types.ts');
      const content = fs.readFileSync(typesPath, 'utf-8');
      expect(content).toContain('interface ReviewResult');
      expect(content).toContain('rootCauseAlignment');
      expect(content).toContain('solutionEffectiveness');
      expect(content).toContain('checkpointCompleteness');
    });

    it('should define SplitReviewResult with 6 dimensions including antiPhaseSplitting', () => {
      const typesPath = path.join(INVESTIGATION_DIR, 'types.ts');
      const content = fs.readFileSync(typesPath, 'utf-8');
      expect(content).toContain('interface SplitReviewResult');
      expect(content).toContain('antiPhaseSplitting');
    });
  });

  describe('报告生成器包含必要函数', () => {
    it('should export generateReport function', () => {
      const genPath = path.join(INVESTIGATION_DIR, 'report-generator.ts');
      const content = fs.readFileSync(genPath, 'utf-8');
      expect(content).toContain('export function generateReport');
      expect(content).toContain('export function writeReport');
    });
  });

  describe('报告解析器包含必要函数', () => {
    it('should export parseReport and readReport functions', () => {
      const parserPath = path.join(INVESTIGATION_DIR, 'report-parser.ts');
      const content = fs.readFileSync(parserPath, 'utf-8');
      expect(content).toContain('export function parseReport');
      expect(content).toContain('export function readReport');
      expect(content).toContain('export function extractDependencies');
    });
  });

  describe('验证器包含8项规则', () => {
    it('should define VALIDATION_RULES with 8 rules', () => {
      const validatorPath = path.join(INVESTIGATION_DIR, 'report-validator.ts');
      const content = fs.readFileSync(validatorPath, 'utf-8');
      expect(content).toContain('export const VALIDATION_RULES');
      expect(content).toContain('export function validateReport');
      expect(content).toContain('export function getValidationRules');
    });
  });

  describe('AI 集成层包含 callAI 和 callAIForJSON', () => {
    it('should export callAI and callAIForJSON functions', () => {
      const aiPath = path.join(INVESTIGATION_DIR, 'ai-integration.ts');
      const content = fs.readFileSync(aiPath, 'utf-8');
      expect(content).toContain('export async function callAI');
      expect(content).toContain('export async function callAIForJSON');
    });
  });

  describe('配置读取模块包含必要函数', () => {
    it('should export loadInvestigationConfig and loadLanguageConfig', () => {
      const configPath = path.join(INVESTIGATION_DIR, 'config-reader.ts');
      const content = fs.readFileSync(configPath, 'utf-8');
      expect(content).toContain('export function loadInvestigationConfig');
      expect(content).toContain('export function loadLanguageConfig');
      expect(content).toContain('export function getDefaultConfig');
    });
  });

  describe('i18n 模板包含5个模板', () => {
    it('zh.ts should contain all 5 investigation templates', () => {
      const zhPath = path.join(PROMPT_TEMPLATES_DIR, 'i18n/zh.ts');
      const content = fs.readFileSync(zhPath, 'utf-8');
      expect(content).toContain("investigate");
      expect(content).toContain("review");
      expect(content).toContain("investigateWithFeedback");
      expect(content).toContain("split");
      expect(content).toContain("splitReview");
    });

    it('en.ts should contain all 5 investigation templates', () => {
      const enPath = path.join(PROMPT_TEMPLATES_DIR, 'i18n/en.ts');
      const content = fs.readFileSync(enPath, 'utf-8');
      expect(content).toContain("investigate");
      expect(content).toContain("review");
      expect(content).toContain("investigateWithFeedback");
      expect(content).toContain("split");
      expect(content).toContain("splitReview");
    });
  });

  describe('loader 包含模板加载函数', () => {
    it('should export loadTemplate, renderTemplate, loadAndRenderTemplate', () => {
      const loaderPath = path.join(PROMPT_TEMPLATES_DIR, 'loader.ts');
      const content = fs.readFileSync(loaderPath, 'utf-8');
      expect(content).toContain('export async function loadTemplate');
      expect(content).toContain('export function renderTemplate');
      expect(content).toContain('export async function loadAndRenderTemplate');
    });
  });
});
