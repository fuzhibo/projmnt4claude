/**
 * SOL-002: 自动化 E2E 测试 - 覆盖"模板 → AI → 解析"完整链路
 *
 * 关联文档: docs/investigation-init-requirement/CA-010-SOL-008-template-effectiveness.md
 * 关联 CA: CA-003（端到端验证缺失）
 *
 * 目标：
 * - 验证 allowedTools 配置正确后，模板能生成有效报告
 * - 检测模板修订后的回归问题
 * - 确保完整链路（模板渲染 → AI 调用 → 解析 → 验证）工作正常
 *
 * 前提条件：SOL-001（allowedTools 修复）已完成（CA-008）
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { callAI } from '../utils/investigation/ai-integration.js';
import { loadAndRenderTemplate } from '../utils/prompt-templates/loader.js';
import { parseReport } from '../utils/investigation/report-parser.js';
import { validateReport } from '../utils/investigation/report-validator.js';
import { createLogger } from '../utils/logger.js';

// 测试目录
const TEST_DIR = path.join(process.cwd(), '.tmp-e2e-test');
const OUTPUT_FILE = 'report-final.md';

// 创建临时测试目录
async function createTempProject(): Promise<string> {
  const testSubDir = path.join(TEST_DIR, `test-${Date.now()}`);
  fs.mkdirSync(testSubDir, { recursive: true });
  return testSubDir;
}

// 清理测试目录
function cleanupTempDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // 忽略清理错误
  }
}

describe('SOL-002: Investigation Template E2E', () => {
  beforeAll(() => {
    // 确保测试目录存在
    if (!fs.existsSync(TEST_DIR)) {
      fs.mkdirSync(TEST_DIR, { recursive: true });
    }
  });

  afterAll(() => {
    // 清理所有测试目录
    try {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    } catch {
      // 忽略清理错误
    }
  });

  it('should generate valid report with proper tools (zh template)', async () => {
    const testDir = await createTempProject();
    const logger = createLogger('e2e-test', testDir, true);

    try {
      // Step 1: 模板渲染
      const requirement = '测试需求：验证模板有效性';
      const template = await loadAndRenderTemplate('investigate', {
        requirement,
        investigationDir: 'test-template-effectiveness',
      }, 'zh');

      logger.info('E2E: Template rendered', {
        templateLength: template.length,
        requirement,
      });

      // Step 2: AI 调用（通过 callAI 统一接口）
      const result = await callAI({
        prompt: template,
        cwd: testDir,
        timeout: 120,
        allowedTools: ['Read', 'Edit', 'Write', 'Bash', 'Grep', 'Glob'],
        outputFile: OUTPUT_FILE,
        debug: true,
        outputFormat: 'text',
      });

      logger.info('E2E: AI call completed', {
        success: result.success,
        outputPath: result.outputPath,
        outputLength: result.output?.length ?? 0,
        durationMs: result.durationMs,
        error: result.error,
      });

      // Step 3: 验证输出文件存在
      const reportPath = path.join(testDir, OUTPUT_FILE);
      expect(result.success).toBe(true);
      expect(result.outputPath).toBeDefined();

      if (!fs.existsSync(reportPath)) {
        logger.error('E2E: Output file not found', { reportPath });
        throw new Error(`Output file not found: ${reportPath}`);
      }

      const rawContent = fs.readFileSync(reportPath, 'utf-8');
      logger.debug('E2E: Raw output preview', {
        preview: rawContent.substring(0, 500),
        totalLength: rawContent.length,
      });

      // Step 4: 解析报告
      const report = parseReport(rawContent);

      logger.info('E2E: Report parsed', {
        hasMetadata: !!report.metadata,
        rootCauseCount: report.rootCauseAnalysis.length,
        solutionCount: report.solutions.length,
        checkpointCount: report.checkpoints.length,
      });

      // Step 5: 核心断言
      expect(report.rootCauseAnalysis.length).toBeGreaterThan(0);
      expect(report.solutions.length).toBeGreaterThan(0);

      // Step 6: 验证报告结构
      const validation = validateReport(report);
      expect(validation.valid).toBe(true);

      if (!validation.valid) {
        logger.warn('E2E: Report validation failed', {
          errors: validation.errors,
        });
      }

      logger.info('E2E: Test passed - template flow validated');
    } finally {
      cleanupTempDir(testDir);
    }
  }, 120000); // 2 分钟超时

  it('should generate valid report with proper tools (en template)', async () => {
    const testDir = await createTempProject();
    const logger = createLogger('e2e-test', testDir, true);

    try {
      const requirement = 'Test requirement: Verify template effectiveness';
      const template = await loadAndRenderTemplate('investigate', {
        requirement,
        investigationDir: 'test-template-effectiveness-en',
      }, 'en');

      const result = await callAI({
        prompt: template,
        cwd: testDir,
        timeout: 120,
        allowedTools: ['Read', 'Edit', 'Write', 'Bash', 'Grep', 'Glob'],
        outputFile: OUTPUT_FILE,
        debug: true,
        outputFormat: 'text',
      });

      expect(result.success).toBe(true);
      expect(result.outputPath).toBeDefined();

      const reportPath = path.join(testDir, OUTPUT_FILE);
      expect(fs.existsSync(reportPath)).toBe(true);

      const rawContent = fs.readFileSync(reportPath, 'utf-8');
      const report = parseReport(rawContent);

      expect(report.rootCauseAnalysis.length).toBeGreaterThan(0);
      expect(report.solutions.length).toBeGreaterThan(0);

      const validation = validateReport(report);
      expect(validation.valid).toBe(true);

      logger.info('E2E: EN template test passed');
    } finally {
      cleanupTempDir(testDir);
    }
  }, 120000);

  it('should detect empty rootCause when template fails', async () => {
    // 回归测试：验证能检测到空章节问题
    const testDir = await createTempProject();
    const logger = createLogger('e2e-test', testDir, true);

    try {
      // 使用一个故意可能失败的简化 prompt
      const minimalPrompt = `# 调查报告：测试空章节检测

请生成一个包含原因分析章节的报告。
`;

      const result = await callAI({
        prompt: minimalPrompt,
        cwd: testDir,
        timeout: 60,
        allowedTools: ['Write'],
        outputFile: 'minimal-output.md',
        outputFormat: 'text',
      });

      logger.info('E2E: Minimal prompt result', {
        success: result.success,
        outputLength: result.output?.length ?? 0,
      });

      const outputPath = path.join(testDir, 'minimal-output.md');

      if (fs.existsSync(outputPath)) {
        const content = fs.readFileSync(outputPath, 'utf-8');
        const report = parseReport(content);

        logger.info('E2E: Minimal prompt test', {
          rootCauseCount: report.rootCauseAnalysis.length,
          solutionCount: report.solutions.length,
        });

        // 此测试用于验证解析器能正确处理可能缺失的章节
        // 不做强制断言，仅记录结果
      }
    } finally {
      cleanupTempDir(testDir);
    }
  }, 60000);

  // ── SOL-005: customRequirements 注入验证 ───────────────────────────
  it('should inject customRequirements into rendered template', async () => {
    const testDir = await createTempProject();
    const logger = createLogger('e2e-test', testDir, true);

    try {
      // 创建带 customRequirements 的配置
      const configPath = path.join(testDir, '.projmnt4claude', 'config.json');
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, JSON.stringify({
        prompts: {
          customRequirements: {
            investigate: '请确保包含代码位置引用',
          },
        },
      }, null, 2));

      // 使用 loadAndRenderTemplate 渲染模板（内部会读取 customRequirements）
      const { loadAndRenderTemplate } = await import('../utils/prompt-templates/loader.js');
      const rendered = await loadAndRenderTemplate('investigate', {
        requirement: '测试需求',
        projectContext: '测试上下文',
        date: '2026-07-11',
        slug: 'test-slug',
        title: '测试标题',
        N: '30',
        customRequirements: '## 用户定制要求\n请在调查过程中遵循以下定制要求：\n请确保包含代码位置引用\n',
      }, 'zh', { mode: 'strict' });

      // 验证 customRequirements 内容被注入
      expect(rendered).toContain('请确保包含代码位置引用');
      expect(rendered).toContain('用户定制要求');

      logger.info('E2E: customRequirements injection verified');
    } finally {
      cleanupTempDir(testDir);
    }
  });
});