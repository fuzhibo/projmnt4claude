/**
 * Investigation 配置读取模块
 *
 * 从 config.json 读取 investigation 配置段，
 * 支持 CLI 参数优先级覆盖。
 */

import * as fs from 'fs';
import * as path from 'path';
import type { InvestigationConfig } from './types.js';

const DEFAULT_CONFIG: InvestigationConfig = {
  splitThreshold: 30,
  maxRetry: 3,
  outputDir: 'docs/investigation',
};

/**
 * 获取项目配置文件路径
 */
function getConfigPath(cwd: string): string {
  return path.join(cwd, '.projmnt4claude', 'config.json');
}

/**
 * 加载 investigation 配置
 *
 * 优先级：
 * 1. CLI 参数（cliThreshold）
 * 2. config.json investigation.splitThreshold
 * 3. 硬编码默认值
 */
export function loadInvestigationConfig(cwd: string, cliThreshold?: number): InvestigationConfig {
  const configPath = getConfigPath(cwd);

  try {
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(content);
      const invConfig = config?.investigation;

      if (invConfig) {
        return {
          splitThreshold: cliThreshold ?? invConfig.splitThreshold ?? DEFAULT_CONFIG.splitThreshold,
          maxRetry: invConfig.maxRetry ?? DEFAULT_CONFIG.maxRetry,
          outputDir: invConfig.outputDir ?? DEFAULT_CONFIG.outputDir,
        };
      }
    }
  } catch {
    // 配置读取失败，使用默认值
  }

  return {
    ...DEFAULT_CONFIG,
    splitThreshold: cliThreshold ?? DEFAULT_CONFIG.splitThreshold,
  };
}

/**
 * 加载 prompts.language 配置
 */
export function loadLanguageConfig(cwd: string): 'zh' | 'en' {
  const configPath = getConfigPath(cwd);

  try {
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(content);
      const lang = config?.prompts?.language;
      if (lang === 'en' || lang === 'zh') {
        return lang;
      }
    }
  } catch {
    // 配置读取失败，使用默认值
  }

  // 尝试从系统环境推断
  const envLang = process.env.LANG || process.env.LC_ALL || '';
  if (envLang.toLowerCase().includes('zh')) {
    return 'zh';
  }

  return 'zh';
}

/**
 * 获取默认配置（供测试和参考）
 */
export function getDefaultConfig(): InvestigationConfig {
  return { ...DEFAULT_CONFIG };
}