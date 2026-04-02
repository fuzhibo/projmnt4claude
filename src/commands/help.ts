import * as fs from 'fs';
import * as path from 'path';
import { getLanguage } from '../i18n';


/**
 * 命令元数据接口
 */
interface CommandMetadata {
  description: string;
  'argument-hint': string;
}

/**
 * 解析命令 markdown 文件的前言元数据
 */
function parseCommandMetadata(filePath: string): CommandMetadata | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const frontmatterMatch = content.match(/^---\n(.*?)\n---/s);

    if (!frontmatterMatch) {
      return null;
  }

    const frontmatter = frontmatterMatch[1]!;
    const metadata: CommandMetadata = {
      description: '',
      'argument-hint': '',
  };

    const descriptionMatch = frontmatter.match(/description:\s*["'](.+?)["']/);
  if (descriptionMatch) {
    metadata.description = descriptionMatch[1]!;
  }

  const argumentMatch = frontmatter.match(/argument-hint:\s["'](.+?)["']/);
  if (argumentMatch) {
    metadata['argument-hint'] = argumentMatch[1]!;
  }

  return metadata;
  } catch (error) {
    return null;
  }
}

/**
 * 获取命令文档目录路径 - 使用新的 locales 目录
 */
function getCommandsDir(cwd: string): string {
  const language = getLanguage(cwd);
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;

  // 优先使用 locales 目录
  if (pluginRoot) {
    const localesDir = path.join(pluginRoot, 'locales', language, 'commands');
    if (fs.existsSync(localesDir)) {
      return localesDir;
    }
  }

  // 回退到旧的 commands 目录
  return path.join(cwd, 'commands');
}

/**
 * 获取所有可用命令列表
 */
function getAvailableCommands(commandsDir: string): string[] {
  try {
    const files = fs.readdirSync(commandsDir);
    return files
      .filter(file => file.endsWith('.md'))
      .map(file => file.replace('.md', ''))
      .sort();
  } catch (error) {
    return [];
  }
}

/**
 * 显示整体帮助（所有命令概览）
 */
function showOverview(commandsDir: string, cwd: string): void {
  const t = require('../i18n').getI18n(getLanguage(cwd));
  const commands = getAvailableCommands(commandsDir);

  console.log('');
  console.log('━'.repeat(70));
  console.log(`📚 ${t.help.commandReference}`);
  console.log('━'.repeat(70));
  console.log('');
  console.log(`${t.help.usage}: projmnt4claude help [command]`);
  console.log('');

  if (commands.length === 0) {
    console.log(t.help.noDescription);
    return;
  }

  // 计算最大命令名宽度
  const maxCommandLength = Math.max(...commands.map(cmd => cmd.length));

  // 表头
  console.log(`${t.help.availableCommands}` + ' '.repeat(maxCommandLength - 22) + ' | ' + t.help.noDescription.split(' ')[0]);
  console.log('─'.repeat(maxCommandLength + 2) + '-+-' + '─'.repeat(50));

  // 命令列表
  for (const command of commands) {
    const metadata = parseCommandMetadata(path.join(commandsDir, `${command}.md`));
    const description = metadata?.description || t.help.noDescription;
    const paddedCommand = command.padEnd(maxCommandLength);
    console.log(`${paddedCommand} | ${description}`);
  }

  console.log('');
  console.log(t.help.tipUseHelp);
  console.log(`      ${t.help.examples}`);
  console.log('');
}

/**
 * 显示特定命令的详细帮助
 */
function showCommandHelp(commandsDir: string, commandName: string, cwd: string): void {
  const t = require('../i18n').getI18n(getLanguage(cwd));
  // 模糊匹配命令
  const commands = getAvailableCommands(commandsDir);
  const matchedCommand = commands.find(cmd => cmd === commandName.toLowerCase());

  if (!matchedCommand) {
    console.log('');
    console.log(`❌ ${t.help.commandNotFound} "${commandName}"`);
    console.log('');
    console.log(`${t.help.availableCommands}:`);
    commands.forEach(cmd => console.log(`  - ${cmd}`));
    console.log('');
    console.log(`${t.help.usage.replace('[command]', 'help')} ${t.help.availableCommands.toLowerCase()}`);
    console.log('');
    return;
  }

  const filePath = path.join(commandsDir, `${matchedCommand}.md`);

  if (!fs.existsSync(filePath)) {
    console.log(`❌ ${t.help.commandNotFound}: ${matchedCommand}`);
    return;
  }

  const content = fs.readFileSync(filePath, 'utf-8');

  // 移除前言元数据，只保留 markdown 内容
  const cleanContent = content.replace(/^---\n.*?\n---\n/s, '');

  console.log('');
  console.log(cleanContent);
}
/**
 * 智能问答 - 根据关键词提供建议
 */
function showSmartHelp(commandsDir: string, topic: string, cwd: string): void {
  const t = require('../i18n').getI18n(getLanguage(cwd));
  const commands = getAvailableCommands(commandsDir);
  const lowerTopic = topic.toLowerCase();

  console.log('');
  console.log('━'.repeat(70));
  console.log(`🔍 ${t.help.usage.replace('[command]', `"${topic}"`)}`);
  console.log('━'.repeat(70));
  console.log('');

  // 关键词映射到命令
  const keywordMap: Record<string, string[]> = {
    // 任务相关
    'task': ['创建任务', '新建任务', '添加任务', '任务管理'],
    'init-requirement': ['需求创建', '自然语言创建任务', '需求分析', '创建需求', 'init-requirement', '需求转任务'],
    'list': ['任务列表', '查看任务', '所有任务', '显示任务'],
    'status': ['任务状态', '更新状态', '项目状态'],
    'execute': ['执行任务', '运行任务', '开始任务'],
    'checkpoint': ['检查点', '验证检查点', '完成任务'],
    'dependency': ['依赖', '任务依赖', '添加依赖'],
    // 项目管理
    'project': ['项目管理', '初始化项目', '项目配置'],
    'init': ['初始化', '首次使用', '开始使用'],
    'setup': ['环境设置', '配置环境', '安装'],
    // 分析和规划
    'plan': ['计划', '执行计划', '任务计划'],
    'analyze': ['分析', '项目分析', '健康检查'],
    // 分支管理
    'branch': ['分支', 'git分支', '创建分支'],
    'git': ['版本控制', '提交', '推送'],
    // 工具
    'tool': ['工具', 'skill', '技能'],
    'hook': ['钩子', '脚本', '自动化'],
  };
  // 查找匹配的命令
  let matchedCommands: string[] = [];

  for (const [command, keywords] of Object.entries(keywordMap)) {
    if (keywords.some(keyword => lowerTopic.includes(keyword) || keyword.includes(lowerTopic))) {
      matchedCommands.push(command);
    }
  }
  // 也检查直接命令名匹配
  const directMatch = commands.find(cmd => lowerTopic.includes(cmd));
  if (directMatch && !matchedCommands.includes(directMatch)) {
    matchedCommands.push(directMatch);
  }
  // 去重并排序
  matchedCommands = [...new Set(matchedCommands)].sort();

  if (matchedCommands.length > 0) {
    console.log('💡 建议您使用以下命令:');
    console.log('');

    for (const cmd of matchedCommands) {
      const metadata = parseCommandMetadata(path.join(commandsDir, `${cmd}.md`));
      const description = metadata?.description || t.help.noDescription;
      console.log(`  📌 ${cmd}`);
      console.log(`     ${description}`);
      console.log(`     ${t.help.usage}: projmnt4claude help ${cmd}`);
      console.log('');
    }
  } else {
    console.log('😕 没有找到直接相关的命令。');
    console.log('');
    console.log('以下是一些常用命令:');
    console.log('  • task     - 管理项目任务');
    console.log('  • status   - 查看项目状态');
    console.log('  • plan     - 管理执行计划');
    console.log('  • setup    - 初始化项目管理环境');
    console.log('');
  }
  console.log(t.help.tipUseHelp);
  console.log('');
}
/**
 * 显示帮助信息
 *
 * @param topic - 可选的主题/命令名
 * @param cwd - 当前工作目录 (默认: process.cwd())
 */
export function showHelp(topic?: string, cwd: string = process.cwd()): void {
  // 获取命令文档目录
  const commandsDir = getCommandsDir(cwd);

  // 检查命令目录是否存在
  if (!fs.existsSync(commandsDir)) {
    const t = require('../i18n').getI18n(getLanguage(cwd));
    console.error(`${t.error}: ${t.help.commandNotFound}`);
    console.error(`路径: ${commandsDir}`);
    process.exit(1);
  }
  // 无参数：显示整体帮助
  if (!topic) {
    showOverview(commandsDir, cwd);
    return;
  }
  // 检查是否是已知命令
  const commands = getAvailableCommands(commandsDir);
  const matchedCommand = commands.find(cmd => cmd === topic.toLowerCase());
  if (matchedCommand) {
    // 是已知命令：显示该命令的详细帮助
    showCommandHelp(commandsDir, topic, cwd);
  } else {
    // 不是已知命令：智能问答
    showSmartHelp(commandsDir, topic, cwd);
  }
}
