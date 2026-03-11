import prompts from 'prompts';
import * as fs from 'fs';
import * as path from 'path';
import { isInitialized, getProjectDir } from '../utils/path';

/**
 * Skill 元数据接口
 */
export interface SkillMeta {
  name: string;
  description: string;
  version: string;
  author?: string;
  tags?: string[];
  sourceType: 'local' | 'git' | 'npm' | 'official';
  sourceUrl?: string;
  entryFile?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * 获取工具箱目录路径
 */
export function getToolboxPath(cwd: string = process.cwd()): string {
  return path.join(getProjectDir(cwd), 'toolbox');
}

/**
 * 获取 skill 目录路径
 */
export function getSkillPath(skillName: string, cwd: string = process.cwd()): string {
  return path.join(getToolboxPath(cwd), skillName);
}

/**
 * 检查 skill 是否存在
 */
export function skillExists(skillName: string, cwd: string = process.cwd()): boolean {
  const skillPath = getSkillPath(skillName, cwd);
  return fs.existsSync(skillPath);
}

/**
 * 读取 skill 元数据
 */
export function readSkillMeta(skillName: string, cwd: string = process.cwd()): SkillMeta | null {
  if (!skillExists(skillName, cwd)) {
    return null;
  }

  const skillPath = getSkillPath(skillName, cwd);
  const metaPath = path.join(skillPath, 'meta.json');

  try {
    const content = fs.readFileSync(metaPath, 'utf-8');
    return JSON.parse(content) as SkillMeta;
  } catch {
    return null;
  }
}

/**
 * 写入 skill 元数据
 */
export function writeSkillMeta(skill: SkillMeta, cwd: string = process.cwd()): void {
  const skillPath = getSkillPath(skill.name, cwd);
  const metaPath = path.join(skillPath, 'meta.json');

  if (!fs.existsSync(skillPath)) {
    fs.mkdirSync(skillPath, { recursive: true });
  }

  skill.updatedAt = new Date().toISOString();
  fs.writeFileSync(metaPath, JSON.stringify(skill, null, 2), 'utf-8');
}

/**
 * 获取所有 skills
 */
export function getAllSkills(cwd: string = process.cwd()): SkillMeta[] {
  const toolboxPath = getToolboxPath(cwd);

  if (!fs.existsSync(toolboxPath)) {
    return [];
  }

  const entries = fs.readdirSync(toolboxPath, { withFileTypes: true });
  const skills: SkillMeta[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const skill = readSkillMeta(entry.name, cwd);
      if (skill) {
        skills.push(skill);
      }
    }
  }

  return skills;
}

/**
 * 列出所有 skills
 */
export function listTools(json: boolean = false, cwd: string = process.cwd()): void {
  if (!isInitialized(cwd)) {
    console.error('错误: 项目未初始化。请先运行 `projmnt4claude setup`');
    process.exit(1);
  }

  const skills = getAllSkills(cwd);

  if (skills.length === 0) {
    console.log('暂无本地 skill');
    return;
  }

  if (json) {
    console.log(JSON.stringify(skills.map(s => ({
      name: s.name,
      description: s.description,
      version: s.version,
      sourceType: s.sourceType,
    })), null, 2));
    return;
  }

  console.log('');
  console.log('名称'.padEnd(20) + '描述'.padEnd(30) + '版本'.padEnd(10) + '来源'.padEnd(12));
  console.log('-'.repeat(75));
  console.log('');

  for (const skill of skills) {
    const name = skill.name.padEnd(20);
    const desc = skill.description.substring(0, 28).padEnd(28);
    const version = skill.version.padEnd(10);
    const source = formatSourceType(skill.sourceType);
    console.log(`${name} | ${desc} | ${version} | ${source}`);
  }

  console.log('');
  console.log(`共 ${skills.length} 个 skill`);
}

/**
 * 格式化来源类型
 */
function formatSourceType(type: string): string {
  const map: Record<string, string> = {
    local: '本地',
    git: 'Git 仓库',
    npm: 'NPM 包',
    official: '官方仓库',
  };
  return map[type] || type;
}

/**
 * 创建新 skill
 */
export async function createTool(cwd: string = process.cwd()): Promise<void> {
  if (!isInitialized(cwd)) {
    console.error('错误: 项目未初始化。请先运行 `projmnt4claude setup`');
    process.exit(1);
  }

  const response = await prompts([
    {
      type: 'text',
      name: 'name',
      message: 'Skill名称 (如 my-skill)',
      validate: (value) => {
        if (!/^[a-z0-9-]+$/.test(value)) {
          return '名称只能包含小写字母、数字和连字符';
        }
        return true;
      },
    },
    {
      type: 'text',
      name: 'description',
      message: '描述 (可选)',
    },
    {
      type: 'text',
      name: 'version',
      message: '版本号',
      initial: '1.0.0',
    },
    {
      type: 'select',
      name: 'sourceType',
      message: '来源类型',
      choices: [
        { title: '本地', value: 'local' },
        { title: 'Git 仓库', value: 'git' },
        { title: 'NPM 包', value: 'npm' },
        { title: '官方仓库', value: 'official' },
      ],
    },
    {
      type: 'text',
      name: 'sourceUrl',
      message: '来源 URL (可选)',
    },
    {
      type: 'text',
      name: 'entryFile',
      message: '入口文件名 (默认 index.ts)',
      initial: 'index.ts',
    },
    {
      type: 'text',
      name: 'author',
      message: '作者 (可选)',
    },
    {
      type: 'list',
      name: 'tags',
      message: '标签 (逗号分隔)',
    },
  ]);

  if (!response.name) {
    console.log('已取消创建');
    return;
  }

  const toolboxPath = getToolboxPath(cwd);
  if (!fs.existsSync(toolboxPath)) {
    fs.mkdirSync(toolboxPath, { recursive: true });
  }

  const skillPath = getSkillPath(response.name, cwd);
  fs.mkdirSync(skillPath, { recursive: true });

  const tagsArray = response.tags
    ? response.tags.split(',').map((t: string) => t.trim()).filter((t: string) => t)
    : [];

  const skill: SkillMeta = {
    name: response.name,
    description: response.description || '',
    version: response.version,
    sourceType: response.sourceType as 'local' | 'git' | 'npm' | 'official',
    sourceUrl: response.sourceUrl,
    entryFile: response.entryFile,
    author: response.author,
    tags: tagsArray,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  writeSkillMeta(skill, cwd);

  const entryFileName = skill.entryFile || 'index.ts';
  const indexPath = path.join(skillPath, entryFileName);
  const indexContent = `#!/usr/bin/env bun
// Skill: ${skill.name}
// Description: ${skill.description}
// Version: ${skill.version}

console.log('Skill ${skill.name} loaded');

export default function main() {
  console.log('Hello from ${skill.name}!');
}
`;
  fs.writeFileSync(indexPath, indexContent);

  const readmePath = path.join(skillPath, 'README.md');
  const tagsList = skill.tags && skill.tags.length > 0
    ? skill.tags.map(t => '- ' + t).join('\n')
    : '暂无标签';
  const readmeContent = `# ${skill.name}

${skill.description || '暂无描述'}

## 信息

- 版本: ${skill.version}
- 作者: ${skill.author || '未知'}
- 来源: ${formatSourceType(skill.sourceType)}
- 入口文件: ${entryFileName}

## 使用

` + '```bash' + `
bun ${entryFileName}
` + '```' + `

## 标签

${tagsList}
`;
  fs.writeFileSync(readmePath, readmeContent);

  console.log(`✅ Skill ${response.name} 创建成功!`);
  console.log(`   目录: ${skillPath}`);
  console.log(`   入口文件: ${entryFileName}`);
}

/**
 * 安装 skill
 */
export async function installTool(source: string, cwd: string = process.cwd()): Promise<void> {
  if (!isInitialized(cwd)) {
    console.error('错误: 项目未初始化。请先运行 `projmnt4claude setup`');
    process.exit(1);
  }

  let skillName: string;

  if (source.startsWith('git:') || source.startsWith('https://github.com/')) {
    const repoMatch = source.match(/^(https?:\/\/github\.com\/)?(.*)\/(.+)$/);
    if (!repoMatch) {
      console.error('错误: 无效的 Git 仓库 URL');
      process.exit(1);
    }
    const repo = repoMatch[3] || '';
    skillName = repo.replace(/\.git$/, '');
    const repoPath = path.join(getToolboxPath(cwd), skillName);
    if (fs.existsSync(repoPath)) {
      console.log(`Skill ${skillName} 已存在于本地工具箱`);
      return;
    }

    console.log('正在从 Git 仓库克隆...');
    console.log(`仓库: ${source}`);
    console.log('Git 克隆功能尚未实现');
    process.exit(1);
  }

  if (source.startsWith('npm:')) {
    skillName = source.replace('npm:', '');
    console.log('正在从 NPM 安装...');
    console.log(`包名: ${skillName}`);
    console.log('NPM 安装功能尚未实现');
    process.exit(1);
  }

  if (source.startsWith('official:')) {
    skillName = source.replace('official:', '');
    console.log('正在从官方仓库安装...');
    console.log(`仓库: ${skillName}`);
    console.log('官方仓库安装功能尚未实现');
    process.exit(1);
  }

  console.error(`错误: 不支持的来源类型 '${source}'`);
  process.exit(1);
}

/**
 * 移除 skill
 */
export async function removeTool(skillName: string, cwd: string = process.cwd()): Promise<void> {
  if (!isInitialized(cwd)) {
    console.error('错误: 项目未初始化。请先运行 `projmnt4claude setup`');
    process.exit(1);
  }

  if (!skillExists(skillName, cwd)) {
    console.error(`错误: Skill '${skillName}' 不存在`);
    process.exit(1);
  }

  const response = await prompts({
    type: 'confirm',
    name: 'confirm',
    message: `确定要删除 skill '${skillName}' 吗?`,
    initial: false,
  });

  if (!response.confirm) {
    console.log('已取消删除');
    return;
  }

  const skillPath = getSkillPath(skillName, cwd);
  fs.rmSync(skillPath, { recursive: true, force: true });

  console.log(`✅ Skill ${skillName} 已删除`);
}

/**
 * 部署 skill 到 Claude Code
 */
export function deployTool(skillName: string, cwd: string = process.cwd()): void {
  if (!isInitialized(cwd)) {
    console.error('错误: 项目未初始化。请先运行 `projmnt4claude setup`');
    process.exit(1);
  }

  if (!skillExists(skillName, cwd)) {
    console.error(`错误: Skill '${skillName}' 不存在`);
    process.exit(1);
  }

  const skill = readSkillMeta(skillName, cwd);
  if (!skill) {
    console.error('错误: 无法读取 skill 元数据');
    process.exit(1);
  }

  const skillPath = getSkillPath(skillName, cwd);
  const claudeSkillPath = path.join(process.cwd(), '.claude', 'skills', skillName);

  if (!fs.existsSync(claudeSkillPath)) {
    fs.mkdirSync(claudeSkillPath, { recursive: true });
  }

  const files = fs.readdirSync(skillPath);
  for (const file of files) {
    if (file === 'meta.json') continue;
    const srcPath = path.join(skillPath, file);
    const destPath = path.join(claudeSkillPath, file);
    fs.copyFileSync(srcPath, destPath);
  }

  console.log(`✅ Skill ${skillName} 已部署到 .claude/skills/${skillName}`);
}

/**
 * 从 Claude 取消部署
 */
export function undeployTool(skillName: string, cwd: string = process.cwd()): void {
  if (!isInitialized(cwd)) {
    console.error('错误: 项目未初始化。请先运行 `projmnt4claude setup`');
    process.exit(1);
  }

  const claudeSkillPath = path.join(process.cwd(), '.claude', 'skills', skillName);
  if (!fs.existsSync(claudeSkillPath)) {
    console.log(`Skill ${skillName} 未部署到 Claude`);
    return;
  }

  fs.rmSync(claudeSkillPath, { recursive: true, force: true });
  console.log(`✅ Skill ${skillName} 已从 Claude 取消部署`);
}
