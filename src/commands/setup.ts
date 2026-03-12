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
} from '../utils/path';

interface ProjectConfig {
  projectName: string;
  createdAt: string;
  branchPrefix: string;
  defaultPriority: 'low' | 'medium' | 'high' | 'urgent';
  language: 'zh' | 'en';
}

const DEFAULT_CONFIG: ProjectConfig = {
  projectName: '',
  createdAt: '',
  branchPrefix: 'task/',
  defaultPriority: 'medium',
  language: 'zh',
};

/**
 * Setup 命令选项
 */
export interface SetupOptions {
  nonInteractive?: boolean;  // 非交互模式：跳过所有确认
  language?: string;         // 指定语言
}

// 国际化文本
const i18n = {
  zh: {
    initializing: '正在初始化项目管理环境...',
    createDir: '创建目录',
    createConfig: '创建配置: config.json',
    createHook: '创建钩子模板: hooks/',
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
    createHook: 'Create hook template: hooks/',
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
}

/**
 * 初始化项目管理环境
 */
export async function setup(cwd: string = process.cwd(), options: SetupOptions = {}): Promise<void> {
  const projectDir = getProjectDir(cwd);

  // 检查是否已初始化
  if (isInitialized(cwd)) {
    console.log('项目管理环境已存在，跳过初始化。');
    console.log(`目录: ${projectDir}`);
    return;
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

  // 创建钩子脚本模板
  createHookTemplates(getHooksDir(cwd), language);

  // 配置 Claude Code hooks（项目级别）
  configureClaudeCodeHooks(cwd, language);

  // 复制技能文件到项目
  copySkillFiles(cwd, language, t);

  console.log(`\n✅ ${t.setupComplete}`);
  console.log(`\n${t.nextStep}`);
}

/**
 * 创建钩子脚本模板
 */
function createHookTemplates(hooksDir: string, language: 'zh' | 'en'): void {
  const isZh = language === 'zh';

  const templates: Record<string, string> = isZh ? {
    'pre-task.ts': `#!/usr/bin/env bun
// 任务执行前钩子
// 在执行任务前自动调用

export default async function preTask(taskId: string) {
  console.log(\`[pre-task] 准备执行任务: \${taskId}\`);
  // 在这里添加自定义逻辑
}
`,
    'post-task.ts': `#!/usr/bin/env bun
// 任务执行后钩子
// 在任务完成后自动调用

export default async function postTask(taskId: string, success: boolean) {
  console.log(\`[post-task] 任务 \${taskId} \${success ? '完成' : '失败'}\`);
  // 在这里添加自定义逻辑
}
`,
    'plan-complete.ts': `#!/usr/bin/env bun
// 计划完成钩子
// 在执行计划全部完成时调用

export default async function planComplete(planId: string) {
  console.log(\`[plan-complete] 计划 \${planId} 已完成\`);
  // 在这里添加自定义逻辑
}
`,
  } : {
    'pre-task.ts': `#!/usr/bin/env bun
// Pre-task hook
// Called automatically before task execution

export default async function preTask(taskId: string) {
  console.log(\`[pre-task] Preparing to execute task: \${taskId}\`);
  // Add custom logic here
}
`,
    'post-task.ts': `#!/usr/bin/env bun
// Post-task hook
// Called automatically after task completion

export default async function postTask(taskId: string, success: boolean) {
  console.log(\`[post-task] Task \${taskId} \${success ? 'completed' : 'failed'}\`);
  // Add custom logic here
}
`,
    'plan-complete.ts': `#!/usr/bin/env bun
// Plan complete hook
// Called when all tasks in the plan are completed

export default async function planComplete(planId: string) {
  console.log(\`[plan-complete] Plan \${planId} completed\`);
  // Add custom logic here
}
`,
  };

  for (const [filename, content] of Object.entries(templates)) {
    const filePath = path.join(hooksDir, filename);
    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`✓ 创建钩子模板: hooks/${filename}`);
  }
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

/**
 * 配置 Claude Code 项目级 hooks
 * 将任务验证 hooks 写入 .claude/settings.json
 */
function configureClaudeCodeHooks(cwd: string, language: 'zh' | 'en'): void {
  const isZh = language === 'zh';

  const claudeDir = path.join(cwd, '.claude');
  const settingsPath = path.join(claudeDir, 'settings.json');

  // 确保 .claude 目录存在
  ensureDir(claudeDir);

  // 读取现有配置或创建新配置
  let settings: Record<string, unknown> = {};
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    } catch {
      // 解析失败，使用空对象
    }
  }

  // 获取 hooks 目录的绝对路径
  const hooksDir = getHooksDir(cwd);

  // 添加任务验证 hooks 配置
  const taskHooks = {
    'PreToolUse': [
      {
        // 在调用 TaskUpdate 前检查是否需要验证
        matcher: 'TaskUpdate',
        hooks: [
          {
            type: 'command',
            command: `bun run ${hooksDir}/pre-complete.ts`
          }
        ]
      }
    ],
    'PostToolUse': [
      {
        // 任务工具调用后的验证提醒
        matcher: 'TaskUpdate|TaskCreate|TaskGet',
        hooks: [
          {
            type: 'command',
            command: `bun run ${hooksDir}/post-task.ts`
          }
        ]
      }
    ]
  };

  // 合并 hooks 配置（不覆盖现有配置）
  settings['hooks'] = {
    ...(settings['hooks'] as Record<string, unknown> || {}),
    ...taskHooks,
  };

  // 写入配置
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');

  if (isZh) {
    console.log('✓ 配置 Claude Code hooks: .claude/settings.json');
    console.log('  - PreToolUse: 任务更新前验证');
    console.log('  - PostToolUse: 任务完成后检查');
  } else {
    console.log('✓ Configured Claude Code hooks: .claude/settings.json');
    console.log('  - PreToolUse: Pre-task verification');
    console.log('  - PostToolUse: Post-task check');
  }
}
