/**
 * E2E 测试: customRequirements 完整链路验证
 *
 * 验证: config set 后 harness 执行 Prompt 包含定制要求
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import {
  createIsolatedTestEnv,
  type IsolatedTestEnv,
} from '../../src/utils/test-env.js';
import {
  loadCustomRequirements,
  loadPromptTemplate,
  resolveTemplate,
} from '../../src/utils/prompt-templates.js';
import type { ProjectConfig } from '../../src/types/config.js';
import { DEFAULT_LOGGING, DEFAULT_AI, DEFAULT_TRAINING } from '../../src/types/config.js';

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

// ── E2E 测试 ──────────────────────────────────────────────
describe('E2E: customRequirements 完整链路', () => {
  let env: IsolatedTestEnv;

  beforeEach(async () => {
    env = await createIsolatedTestEnv({ autoInit: false });
  });

  afterEach(() => {
    env.cleanup();
  });

  test('dev 阶段: customRequirements 注入到 Prompt', () => {
    const customReq = 'Focus on performance optimization';
    createTestConfigFile(env.projectDir, baseConfig({
      prompts: {
        language: 'en',
        customRequirements: { dev: customReq },
      },
    }));

    // 1. 验证 loadCustomRequirements 返回正确内容
    const customSection = loadCustomRequirements('dev', env.tempDir);
    expect(customSection).toContain('## Custom Requirements');
    expect(customSection).toContain(customReq);

    // 2. 验证模板包含 {customRequirements} 占位符
    const template = loadPromptTemplate('dev', env.tempDir);
    expect(template).toContain('{customRequirements}');

    // 3. 验证 resolveTemplate 正确替换
    const resolved = resolveTemplate(template, {
      customRequirements: customSection,
    });
    expect(resolved).toContain('## Custom Requirements');
    expect(resolved).toContain(customReq);
    expect(resolved).not.toContain('{customRequirements}');
  });

  test('codeReview 阶段: customRequirements 注入到 Prompt', () => {
    const customReq = '重点关注安全性审查';
    createTestConfigFile(env.projectDir, baseConfig({
      language: 'zh',
      prompts: {
        customRequirements: { codeReview: customReq },
      },
    }));

    const customSection = loadCustomRequirements('codeReview', env.tempDir);
    expect(customSection).toContain('## 定制需求');
    expect(customSection).toContain(customReq);

    const template = loadPromptTemplate('codeReview', env.tempDir);
    const resolved = resolveTemplate(template, {
      customRequirements: customSection,
    });
    expect(resolved).toContain('## 定制需求');
    expect(resolved).toContain(customReq);
  });

  test('qa 阶段: customRequirements 注入到 Prompt', () => {
    const customReq = 'Verify edge cases thoroughly';
    createTestConfigFile(env.projectDir, baseConfig({
      prompts: {
        language: 'en',
        customRequirements: { qa: customReq },
      },
    }));

    const customSection = loadCustomRequirements('qa', env.tempDir);
    expect(customSection).toContain('## Custom Requirements');
    expect(customSection).toContain(customReq);

    const template = loadPromptTemplate('qa', env.tempDir);
    const resolved = resolveTemplate(template, {
      customRequirements: customSection,
    });
    expect(resolved).toContain(customReq);
  });

  test('evaluation 阶段: customRequirements 注入到 Prompt', () => {
    const customReq = '评估代码可维护性';
    createTestConfigFile(env.projectDir, baseConfig({
      language: 'zh',
      prompts: {
        customRequirements: { evaluation: customReq },
      },
    }));

    const customSection = loadCustomRequirements('evaluation', env.tempDir);
    expect(customSection).toContain('## 定制需求');
    expect(customSection).toContain(customReq);

    const template = loadPromptTemplate('evaluation', env.tempDir);
    const resolved = resolveTemplate(template, {
      customRequirements: customSection,
    });
    expect(resolved).toContain(customReq);
  });

  test('多阶段配置: 不同阶段有不同定制需求', () => {
    createTestConfigFile(env.projectDir, baseConfig({
      language: 'zh',
      prompts: {
        customRequirements: {
          dev: '开发阶段关注性能',
          codeReview: '审核阶段关注安全',
          qa: '测试阶段覆盖边界',
          evaluation: '评估阶段验证完整性',
        },
      },
    }));

    // 验证各阶段独立获取
    expect(loadCustomRequirements('dev', env.tempDir)).toContain('开发阶段关注性能');
    expect(loadCustomRequirements('codeReview', env.tempDir)).toContain('审核阶段关注安全');
    expect(loadCustomRequirements('qa', env.tempDir)).toContain('测试阶段覆盖边界');
    expect(loadCustomRequirements('evaluation', env.tempDir)).toContain('评估阶段验证完整性');
  });

  test('无配置时: customRequirements 为空，Prompt 正常生成', () => {
    createTestConfigFile(env.projectDir, baseConfig());

    const customSection = loadCustomRequirements('dev', env.tempDir);
    expect(customSection).toBe('');

    const template = loadPromptTemplate('dev', env.tempDir);
    const resolved = resolveTemplate(template, {
      customRequirements: customSection,
    });
    // 模板应该正常解析，不会有未替换的占位符
    expect(resolved).not.toContain('{customRequirements}');
  });

  test('语言优先级: prompts.language 覆盖全局 language', () => {
    createTestConfigFile(env.projectDir, baseConfig({
      language: 'zh',
      prompts: {
        language: 'en',
        customRequirements: { dev: 'Use English title' },
      },
    }));

    const customSection = loadCustomRequirements('dev', env.tempDir);
    // 应该使用 prompts.language (en) 而不是全局 language (zh)
    expect(customSection).toContain('## Custom Requirements');
    expect(customSection).not.toContain('## 定制需求');
  });
});
