import * as fs from 'fs';
import * as path from 'path';
import type { InvestigationConfig } from './types';

const DEFAULT_CONFIG: InvestigationConfig = {
  splitThreshold: 30,
  maxRetry: 3,
  outputDir: 'docs/investigation',
};

/**
 * 加载 investigation 配置
 *
 * 优先级：
 * 1. cliThreshold（CLI --split-threshold 参数）
 * 2. config.json → investigation.splitThreshold
 * 3. 硬编码默认值 30KB
 */
export function loadInvestigationConfig(cwd: string, cliThreshold?: number): InvestigationConfig {
  try {
    const configPath = findConfigPath(cwd);
    if (configPath && fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(raw);
      const inv = config?.investigation;
      if (inv) {
        return {
          splitThreshold: cliThreshold ?? inv.splitThreshold ?? DEFAULT_CONFIG.splitThreshold,
          maxRetry: inv.maxRetry ?? DEFAULT_CONFIG.maxRetry,
          outputDir: inv.outputDir ?? DEFAULT_CONFIG.outputDir,
        };
      }
    }
  } catch {
    // 使用默认值
  }

  return {
    ...DEFAULT_CONFIG,
    splitThreshold: cliThreshold ?? DEFAULT_CONFIG.splitThreshold,
  };
}

/**
 * 获取模板语言配置
 *
 * 优先级：
 * 1. config.json → prompts.language
 * 2. 默认 → 'zh'
 */
export function loadLanguageConfig(cwd: string): 'zh' | 'en' {
  try {
    const configPath = findConfigPath(cwd);
    if (configPath && fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(raw);
      const lang = config?.prompts?.language;
      if (lang === 'zh' || lang === 'en') return lang;
    }
  } catch {
    // 回退到默认
  }
  return 'zh';
}

/**
 * 查找项目配置文件路径
 */
function findConfigPath(cwd: string): string | null {
  // 查找 .projmnt4claude/config.json
  const configPath = path.join(cwd, '.projmnt4claude', 'config.json');
  if (fs.existsSync(configPath)) return configPath;

  // 回退：项目根目录 config.json
  const rootConfig = path.join(cwd, 'config.json');
  if (fs.existsSync(rootConfig)) return rootConfig;

  return null;
}