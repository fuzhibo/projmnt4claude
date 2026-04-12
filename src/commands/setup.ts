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
  getHooksDir,
  getBinDir,
  getReportsDir,
  getLogsDir,
} from '../utils/path';
import { Pre } from '../utils/pre';
import { DEFAULT_GIT_HOOK, type GitHookConfig } from '../types/config';

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

// 国际化文本
const i18n = {
  zh: {
    initializing: '正在初始化项目管理环境...',
    createDir: '创建目录',
    createConfig: '创建配置: config.json',
    setupComplete: '项目管理环境初始化完成！',
    nextStep: '使用 \'projmnt4claude task create\' 创建第一个任务',
    selectLanguage: '请选择语言:',
    chinese: '中文',
    english: 'English',
    copyingSkills: '正在复制技能文件...',
    skillsCopied: '技能文件复制完成',
  },
  en: {
    initializing: 'Initializing project management environment...',
    createDir: 'Create directory',
    createConfig: 'Create config: config.json',
    setupComplete: 'Project management environment initialized!',
    nextStep: 'Use \'projmnt4claude task create\' to create your first task',
    selectLanguage: 'Select language:',
    chinese: '中文',
    english: 'English',
    copyingSkills: 'Copying skill files...',
    skillsCopied: 'Skill files copied',
  },
};

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

  // 检查是否已初始化
  if (isInitialized(cwd) && !options.force) {
    console.log('项目管理环境已存在，跳过初始化。');
    console.log(`目录: ${projectDir}`);
    console.log('提示: 使用 --force 选项强制重新初始化（重新复制技能文件）');
    return;
  }

  if (options.force && isInitialized(cwd)) {
    console.log('⚠️ 强制重新初始化模式...');
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
      message: i18n.zh.selectLanguage + ' / ' + i18n.en.selectLanguage,
      choices: [
        { title: i18n.zh.chinese, value: 'zh' },
        { title: i18n.en.english, value: 'en' },
      ],
      initial: 0,
    });
    language = langResponse.language || 'zh';
  }
  const t = i18n[language];

  console.log(t.initializing);

  // 创建主目录
  ensureDir(projectDir);
  console.log(`✓ ${t.createDir}: ${projectDir}`);

  // 创建子目录
  const subDirs = [
    { dir: getTasksDir(cwd), name: 'tasks' },
    { dir: getArchiveDir(cwd), name: 'archive' },
    { dir: getToolboxDir(cwd), name: 'toolbox' },
    { dir: getHooksDir(cwd), name: 'hooks' },
    { dir: getBinDir(cwd), name: 'bin' },
    { dir: getReportsDir(cwd), name: 'reports' },
    { dir: getLogsDir(cwd), name: 'logs' },
  ];

  for (const { dir, name } of subDirs) {
    ensureDir(dir);
    console.log(`✓ ${t.createDir}: ${name}/`);
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
  console.log(`✓ ${t.createConfig}`);

  // 复制技能文件到项目
  copySkillFiles(cwd, language, t);

  // Git Hook 创建（配置驱动）
  const gitHookConfig = config.gitHook ?? DEFAULT_GIT_HOOK;
  if (gitHookConfig.enabled) {
    const pre = new Pre(cwd);
    if (fs.existsSync(pre.gitDir)) {
      try {
        pre.installAll();
        console.log('  ✓ Git Hook 创建完成 (pre-commit, prepublishOnly)');
      } catch (e) {
        console.log(`  ⚠️ Git Hook 创建失败: ${(e as Error).message}`);
      }
    }
  } else {
    console.log('  ⏭️  Git Hook 创建已通过配置禁用 (gitHook.enabled = false)');
  }

  console.log(`\n✅ ${t.setupComplete}`);
  console.log(`\n${t.nextStep}`);
}

/**
 * 复制技能文件到项目
 */
function copySkillFiles(cwd: string, language: 'zh' | 'en', t: typeof i18n.zh): void {
  console.log(`\n📦 ${t.copyingSkills}`);

  // 获取插件根目录
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
  if (!pluginRoot) {
    console.log('  ⚠️ CLAUDE_PLUGIN_ROOT 环境变量未设置，跳过技能文件复制');
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
    console.log(`  ✓ 复制 SKILL.md (${language})`);
  } else {
    // 回退到默认位置
    const defaultSource = path.join(pluginRoot, 'skills', 'projmnt4claude', 'SKILL.md');
    if (fs.existsSync(defaultSource)) {
      fs.copyFileSync(defaultSource, skillTarget);
      console.log(`  ✓ 复制 SKILL.md (default)`);
    } else {
      console.log(`  ⚠️ SKILL.md 未找到`);
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
    console.log(`  ✓ 复制 ${commandFiles.length} 个命令文档 (${language})`);
  } else {
    console.log(`  ⚠️ 命令文档目录未找到: ${commandsSourceDir}`);
  }

  console.log(`✅ ${t.skillsCopied}`);
}

