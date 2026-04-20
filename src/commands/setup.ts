import * as fs from 'fs';
import * as path from 'path';
import prompts from 'prompts';
import {
  getProjectDir,
  ensureDir,
  isInitialized,
  getConfigPath,
  getTasksDir,
  getArchiveDir,
  getToolboxDir,
  getBinDir,
  getReportsDir,
  getLogsDir,
} from '../utils/path';
import { Pre } from '../utils/pre';
import { DEFAULT_GIT_HOOK, type GitHookConfig } from '../types/config';
import { t } from '../i18n';

interface ProjectConfig {
  projectName: string;
  createdAt: string;
  branchPrefix: string;
  defaultPriority: 'low' | 'medium' | 'high' | 'urgent';
  language: 'zh' | 'en';
  /** AI Agent 配置 */
  ai?: {
    /** 提供者标识，默认 'claude-code' */
    provider: string;
    /** 提供者专有配置 */
    providerOptions?: Record<string, unknown>;
  };
  /** Git Hook 配置 */
  gitHook?: GitHookConfig;
}

const DEFAULT_CONFIG: ProjectConfig = {
  projectName: '',
  createdAt: '',
  branchPrefix: 'task/',
  defaultPriority: 'medium',
  language: 'zh',
  ai: { provider: 'claude-code' },
};

// 使用全局 i18n 系统，不再使用本地 i18n 对象

/**
 * 初始化选项接口
 */
export interface SetupOptions {
  nonInteractive?: boolean;
  language?: 'zh' | 'en';
  force?: boolean;  // 强制重新初始化
}

/**
 * 初始化项目管理环境
 */
export async function setup(cwd: string = process.cwd(), options: SetupOptions = {}): Promise<void> {
  const projectDir = getProjectDir(cwd);
  const texts = t(cwd);

  // 检查是否已初始化
  if (isInitialized(cwd) && !options.force) {
    console.log(texts.setupCmd.alreadyInitialized);
    console.log(texts.setupCmd.directory.replace('{path}', projectDir));
    console.log(texts.setupCmd.tipUseForce);
    return;
  }

  if (options.force && isInitialized(cwd)) {
    console.log(texts.setupCmd.forceMode);
  }

  // 语言选择
  let language: 'zh' | 'en';
  if (options.language) {
    // 从命令行参数获取语言
    language = options.language;
  } else if (options.nonInteractive) {
    // 非交互模式使用默认语言
    language = 'zh';
  } else {
    // 交互式选择语言
    const langResponse = await prompts({
      type: 'select',
      name: 'language',
      message: texts.setup.selectLanguage,
      choices: [
        { title: texts.setup.chinese, value: 'zh' },
        { title: texts.setup.english, value: 'en' },
      ],
      initial: 0,
    });
    language = langResponse.language || 'zh';
  }

  console.log(texts.setup.initializing);

  // 创建主目录
  ensureDir(projectDir);
  console.log(`✓ ${texts.setup.createDir}: ${projectDir}`);

  // 创建子目录
  const subDirs = [
    { dir: getTasksDir(cwd), name: 'tasks' },
    { dir: getArchiveDir(cwd), name: 'archive' },
    { dir: getToolboxDir(cwd), name: 'toolbox' },
    { dir: getBinDir(cwd), name: 'bin' },
    { dir: getReportsDir(cwd), name: 'reports' },
    { dir: getLogsDir(cwd), name: 'logs' },
  ];

  for (const { dir, name } of subDirs) {
    ensureDir(dir);
    console.log(`✓ ${texts.setup.createDir}: ${name}/`);
  }

  // 创建默认配置文件
  const config: ProjectConfig = {
    ...DEFAULT_CONFIG,
    projectName: path.basename(cwd),
    createdAt: new Date().toISOString(),
    language,
  };

  const configPath = getConfigPath(cwd);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  console.log(`✓ ${texts.setup.createConfig}`);

  // 复制技能文件到项目
  copySkillFiles(cwd, language, texts);

  // Git Hook 创建（配置驱动）
  const gitHookConfig = config.gitHook ?? DEFAULT_GIT_HOOK;
  if (gitHookConfig.enabled) {
    const pre = new Pre(cwd);
    if (fs.existsSync(pre.gitDir)) {
      try {
        pre.installAll();
        console.log(texts.setupCmd.gitHookCreated);
      } catch (e) {
        console.log(texts.setupCmd.gitHookFailed.replace('{error}', (e as Error).message));
      }
    }
  } else {
    console.log(texts.setupCmd.gitHookDisabled);
  }

  console.log(`\n✅ ${texts.setup.setupComplete}`);
  console.log(`\n${texts.setup.nextStep}`);
}

/**
 * 复制技能文件到项目
 */
function copySkillFiles(cwd: string, language: 'zh' | 'en', texts: ReturnType<typeof t>): void {
  console.log(`\n📦 ${texts.setup.copyingSkills}`);

  // 获取插件根目录
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
  if (!pluginRoot) {
    console.log(texts.setupCmd.pluginRootNotSet);
    return;
  }

  const toolboxDir = getToolboxDir(cwd);
  const skillName = 'projmnt4claude';
  const targetDir = path.join(toolboxDir, skillName);

  // 创建目标目录
  ensureDir(targetDir);
  ensureDir(path.join(targetDir, 'skills'));

  // 复制 SKILL.md - 使用新的 locales 目录
  const skillSource = path.join(pluginRoot, 'locales', language, 'SKILL.md');
  const skillTarget = path.join(targetDir, 'SKILL.md');

  if (fs.existsSync(skillSource)) {
    fs.copyFileSync(skillSource, skillTarget);
    console.log(texts.setupCmd.copySkillFile.replace('{language}', language));
  } else {
    // 回退到默认位置
    const defaultSource = path.join(pluginRoot, 'skills', 'projmnt4claude', 'SKILL.md');
    if (fs.existsSync(defaultSource)) {
      fs.copyFileSync(defaultSource, skillTarget);
      console.log(texts.setupCmd.copyDefault);
    } else {
      console.log(texts.setupCmd.fileNotFound);
    }
  }

  // 复制命令文档 - 使用新的 locales 目录
  const commandsSourceDir = path.join(pluginRoot, 'locales', language, 'commands');
  const commandsTargetDir = path.join(targetDir, 'commands');
  ensureDir(commandsTargetDir);

  if (fs.existsSync(commandsSourceDir)) {
    const commandFiles = fs.readdirSync(commandsSourceDir).filter(f => f.endsWith('.md'));
    for (const file of commandFiles) {
      fs.copyFileSync(
        path.join(commandsSourceDir, file),
        path.join(commandsTargetDir, file)
      );
    }
    console.log(texts.setupCmd.copyCommandDocs.replace('{count}', String(commandFiles.length)).replace('{language}', language));
  } else {
    console.log(texts.setupCmd.dirNotFound.replace('{path}', commandsSourceDir));
  }

  console.log(`✅ ${texts.setup.skillsCopied}`);
}

