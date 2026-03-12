import * as fs from 'fs';
import * as path from 'path';
import {
  isInitialized,
  getProjectDir,
  getTasksDir,
  getToolboxDir,
  getHooksDir,
} from '../utils/path';
import { getAllTaskIds } from '../utils/task';

/**
 * 检查结果接口
 */
interface CheckResult {
  name: string;
  status: 'ok' | 'warning' | 'error';
  message: string;
  details?: string[];
  fixable: boolean;
}

/**
 * 运行环境诊断
 */
export async function runDoctor(fix: boolean = false, cwd: string = process.cwd()): Promise<void> {
  console.log('');
  console.log('━'.repeat(60));
  console.log('🔍 环境诊断');
  console.log('━'.repeat(60));
  console.log('');

  const results: CheckResult[] = [];

  // 1. 检查项目初始化状态
  results.push(checkProjectInit(cwd));

  // 只有项目已初始化才检查后续项
  if (isInitialized(cwd)) {
    // 2. 检查插件缓存
    results.push(checkPluginCache());

    // 3. 检查项目技能文件
    results.push(...checkSkillFiles(cwd));

    // 4. 检查任务命名格式
    results.push(...checkTaskNaming(cwd));

    // 5. 检查目录结构完整性
    results.push(...checkDirectoryStructure(cwd));

    // 6. 检查 Hooks 配置
    results.push(...checkHooksConfiguration(cwd));
  }

  // 显示结果
  displayResults(results);

  // 如果有可修复的问题且开启了 --fix
  const fixableIssues = results.filter(r => r.status !== 'ok' && r.fixable);
  if (fix && fixableIssues.length > 0) {
    console.log('');
    console.log('━'.repeat(60));
    console.log('🔧 自动修复');
    console.log('━'.repeat(60));
    console.log('');

    await fixIssues(fixableIssues, cwd);

    // 重新检查
    console.log('');
    console.log('🔄 重新检查...');
    console.log('');
    await runDoctor(false, cwd);
    return;
  } else if (fixableIssues.length > 0) {
    console.log('');
    console.log(`💡 使用 --fix 参数自动修复 ${fixableIssues.length} 个问题`);
  }
}

/**
 * 检查项目初始化状态
 */
function checkProjectInit(cwd: string): CheckResult {
  const projectDir = getProjectDir(cwd);
  const configPath = path.join(projectDir, 'config.json');

  if (!fs.existsSync(configPath)) {
    return {
      name: '项目初始化',
      status: 'error',
      message: '项目未初始化',
      details: ['请运行 projmnt4claude setup 初始化项目'],
      fixable: false,
    };
  }

  return {
    name: '项目初始化',
    status: 'ok',
    message: '项目已初始化',
    details: [`配置文件: ${configPath}`],
    fixable: false,
  };
}

/**
 * 检查插件缓存
 */
function checkPluginCache(): CheckResult {
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
  const details: string[] = [];
  let status: 'ok' | 'warning' | 'error' = 'ok';
  let message = '插件缓存正常';

  if (!pluginRoot) {
    return {
      name: '插件缓存',
      status: 'warning',
      message: 'CLAUDE_PLUGIN_ROOT 环境变量未设置',
      details: ['这可能是因为插件未正确安装或环境变量未配置'],
      fixable: false,
    };
  }

  details.push(`插件根目录: ${pluginRoot}`);

  // 检查主文件
  const mainFile = path.join(pluginRoot, 'dist', 'projmnt4claude.js');
  if (!fs.existsSync(mainFile)) {
    status = 'error';
    message = '主程序文件缺失';
    details.push(`缺失: ${mainFile}`);
  } else {
    details.push(`✓ 主程序: ${mainFile}`);
  }

  // 检查 locales 目录
  const localesDir = path.join(pluginRoot, 'locales');
  if (!fs.existsSync(localesDir)) {
    if (status !== 'error') {
      status = 'warning';
      message = 'locales 目录缺失';
    }
    details.push(`缺失: ${localesDir}`);
  } else {
    // 检查语言目录
    const zhDir = path.join(localesDir, 'zh');
    const enDir = path.join(localesDir, 'en');

    if (fs.existsSync(zhDir)) {
      details.push('✓ 中文语言包: locales/zh/');
    }
    if (fs.existsSync(enDir)) {
      details.push('✓ 英文语言包: locales/en/');
    }

    if (!fs.existsSync(zhDir) && !fs.existsSync(enDir)) {
      if (status !== 'error') {
        status = 'warning';
        message = '语言包目录缺失';
      }
      details.push('警告: 未找到任何语言包目录');
    }
  }

  // 检查 commands 目录
  const commandsDir = path.join(pluginRoot, 'commands');
  if (!fs.existsSync(commandsDir)) {
    if (status !== 'error') {
      status = 'warning';
      message = 'commands 目录缺失（slash commands 可能无法工作）';
    }
    details.push(`缺失: ${commandsDir}`);
  } else {
    const commandFiles = fs.readdirSync(commandsDir).filter(f => f.endsWith('.md'));
    details.push(`✓ Slash commands: ${commandFiles.length} 个`);
  }

  return {
    name: '插件缓存',
    status,
    message,
    details,
    fixable: false,
  };
}

/**
 * 检查项目技能文件
 */
function checkSkillFiles(cwd: string): CheckResult[] {
  const results: CheckResult[] = [];
  const toolboxDir = getToolboxDir(cwd);
  const skillDir = path.join(toolboxDir, 'projmnt4claude');

  // 检查 SKILL.md
  const skillFile = path.join(skillDir, 'SKILL.md');
  if (!fs.existsSync(skillFile)) {
    results.push({
      name: '技能文件',
      status: 'warning',
      message: 'SKILL.md 缺失',
      details: ['项目中的技能文件不存在，可能需要重新运行 setup'],
      fixable: true,
    });
  } else {
    results.push({
      name: '技能文件',
      status: 'ok',
      message: 'SKILL.md 存在',
      details: [`位置: ${skillFile}`],
      fixable: false,
    });
  }

  // 检查 commands 目录
  const commandsDir = path.join(skillDir, 'commands');
  if (fs.existsSync(commandsDir)) {
    const commandFiles = fs.readdirSync(commandsDir).filter(f => f.endsWith('.md'));
    results.push({
      name: '命令文档',
      status: 'ok',
      message: `${commandFiles.length} 个命令文档`,
      details: [`位置: ${commandsDir}`],
      fixable: false,
    });
  } else {
    results.push({
      name: '命令文档',
      status: 'warning',
      message: '命令文档目录缺失',
      details: ['可能需要重新运行 setup 来复制命令文档'],
      fixable: true,
    });
  }

  return results;
}

/**
 * 检查任务命名格式
 */
function checkTaskNaming(cwd: string): CheckResult[] {
  const results: CheckResult[] = [];
  const tasksDir = getTasksDir(cwd);

  if (!fs.existsSync(tasksDir)) {
    return [{
      name: '任务命名',
      status: 'ok',
      message: '任务目录不存在（无任务）',
      details: [],
      fixable: false,
    }];
  }

  const taskIds = getAllTaskIds(cwd);
  const invalidTasks: string[] = [];
  const taskPattern = /^TASK-\d{3,}$/;

  for (const taskId of taskIds) {
    if (!taskPattern.test(taskId)) {
      invalidTasks.push(taskId);
    }
  }

  if (invalidTasks.length === 0) {
    results.push({
      name: '任务命名',
      status: 'ok',
      message: `所有 ${taskIds.length} 个任务命名格式正确`,
      details: ['格式: TASK-XXX'],
      fixable: false,
    });
  } else {
    results.push({
      name: '任务命名',
      status: 'warning',
      message: `${invalidTasks.length} 个任务命名格式不规范`,
      details: [
        '不规范的命名:',
        ...invalidTasks.slice(0, 5).map(t => `  - ${t}`),
        ...(invalidTasks.length > 5 ? [`  ... 还有 ${invalidTasks.length - 5} 个`] : []),
        '建议格式: TASK-XXX',
      ],
      fixable: false, // 任务重命名需要手动处理
    });
  }

  return results;
}

/**
 * 检查目录结构完整性
 */
function checkDirectoryStructure(cwd: string): CheckResult[] {
  const results: CheckResult[] = [];
  const projectDir = getProjectDir(cwd);

  const requiredDirs = [
    { name: 'tasks', path: getTasksDir(cwd) },
    { name: 'toolbox', path: getToolboxDir(cwd) },
  ];

  const optionalDirs = [
    { name: 'archive', path: path.join(projectDir, 'archive') },
    { name: 'hooks', path: path.join(projectDir, 'hooks') },
    { name: 'bin', path: path.join(projectDir, 'bin') },
    { name: 'reports', path: path.join(projectDir, 'reports') },
  ];

  // 检查必需目录
  for (const dir of requiredDirs) {
    if (!fs.existsSync(dir.path)) {
      results.push({
        name: `目录: ${dir.name}`,
        status: 'error',
        message: '必需目录缺失',
        details: [`缺失: ${dir.path}`],
        fixable: true,
      });
    } else {
      results.push({
        name: `目录: ${dir.name}`,
        status: 'ok',
        message: '存在',
        details: [],
        fixable: false,
      });
    }
  }

  // 检查可选目录
  for (const dir of optionalDirs) {
    if (!fs.existsSync(dir.path)) {
      results.push({
        name: `目录: ${dir.name}`,
        status: 'warning',
        message: '可选目录缺失',
        details: [`缺失: ${dir.path}`],
        fixable: true,
      });
    }
  }

  return results;
}

/**
 * 检查 Hooks 配置
 */
function checkHooksConfiguration(cwd: string): CheckResult[] {
  const results: CheckResult[] = [];
  const projectDir = getProjectDir(cwd);
  const hooksDir = getHooksDir(cwd);
  const claudeSettingsPath = path.join(cwd, '.claude', 'settings.json');

  // 1. 检查 hooks 目录是否存在
  if (!fs.existsSync(hooksDir)) {
    results.push({
      name: 'Hooks 目录',
      status: 'warning',
      message: 'hooks 目录缺失',
      details: ['任务验证 Hook 机制需要 hooks 目录'],
      fixable: true,
    });
    return results;
  }

  results.push({
    name: 'Hooks 目录',
    status: 'ok',
    message: '存在',
    details: [`位置: ${hooksDir}`],
    fixable: false,
  });

  // 2. 检查必需的 hook 文件
  const requiredHooks = ['pre-complete.ts', 'post-task.ts'];
  for (const hookFile of requiredHooks) {
    const hookPath = path.join(hooksDir, hookFile);
    if (!fs.existsSync(hookPath)) {
      results.push({
        name: `Hook: ${hookFile}`,
        status: 'warning',
        message: '缺失',
        details: [`任务验证需要此 Hook: ${hookPath}`],
        fixable: true,
      });
    } else {
      results.push({
        name: `Hook: ${hookFile}`,
        status: 'ok',
        message: '存在',
        details: [],
        fixable: false,
      });
    }
  }

  // 3. 检查 .claude/settings.json 中的 hooks 配置
  if (fs.existsSync(claudeSettingsPath)) {
    try {
      const settings = JSON.parse(fs.readFileSync(claudeSettingsPath, 'utf-8'));
      const hooks = settings.hooks as Record<string, unknown> | undefined;

      if (!hooks || !hooks.PreToolUse || !hooks.PostToolUse) {
        results.push({
          name: 'Claude Code Hooks 配置',
          status: 'warning',
          message: 'hooks 配置不完整',
          details: [
            '.claude/settings.json 中缺少必要的 hooks 配置',
            '需要: PreToolUse 和 PostToolUse hooks',
          ],
          fixable: true,
        });
      } else {
        // 检查是否配置了任务验证相关的 hooks
        const preToolUseHooks = hooks.PreToolUse as Array<{ matcher?: string }>;
        const hasTaskHook = preToolUseHooks?.some(h => h.matcher?.includes('Task'));

        if (!hasTaskHook) {
          results.push({
            name: 'Claude Code Hooks 配置',
            status: 'warning',
            message: '缺少任务验证 hooks',
            details: ['PreToolUse hooks 中没有配置任务相关的验证'],
            fixable: true,
          });
        } else {
          results.push({
            name: 'Claude Code Hooks 配置',
            status: 'ok',
            message: '配置完整',
            details: ['已配置任务验证 hooks'],
            fixable: false,
          });
        }
      }
    } catch {
      results.push({
        name: 'Claude Code Hooks 配置',
        status: 'warning',
        message: '无法解析 settings.json',
        details: ['文件可能格式错误'],
        fixable: true,
      });
    }
  } else {
    results.push({
      name: 'Claude Code Hooks 配置',
      status: 'warning',
      message: '.claude/settings.json 不存在',
      details: ['需要配置 hooks 以启用任务验证机制'],
      fixable: true,
    });
  }

  return results;
}

/**
 * 显示检查结果
 */
function displayResults(results: CheckResult[]): void {
  // 按状态排序：error > warning > ok
  const sorted = [...results].sort((a, b) => {
    const order = { error: 0, warning: 1, ok: 2 };
    return order[a.status] - order[b.status];
  });

  let errorCount = 0;
  let warningCount = 0;
  let okCount = 0;

  for (const result of sorted) {
    const icon = result.status === 'ok' ? '✅' : result.status === 'warning' ? '⚠️' : '❌';
    console.log(`${icon} ${result.name}: ${result.message}`);

    if (result.details && result.details.length > 0) {
      for (const detail of result.details) {
        console.log(`   ${detail}`);
      }
    }

    if (result.status === 'error') errorCount++;
    else if (result.status === 'warning') warningCount++;
    else okCount++;
  }

  console.log('');
  console.log('━'.repeat(60));
  console.log(`📊 汇总: ${errorCount} 错误, ${warningCount} 警告, ${okCount} 正常`);

  if (errorCount === 0 && warningCount === 0) {
    console.log('✅ 所有检查通过！');
  }
}

/**
 * 修复问题
 */
async function fixIssues(issues: CheckResult[], cwd: string): Promise<void> {
  const projectDir = getProjectDir(cwd);
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;

  for (const issue of issues) {
    console.log(`修复: ${issue.name}...`);

    if (issue.name === '技能文件' || issue.name === '命令文档') {
      // 重新复制技能文件
      if (pluginRoot) {
        const toolboxDir = getToolboxDir(cwd);
        const skillDir = path.join(toolboxDir, 'projmnt4claude');

        // 创建目录
        if (!fs.existsSync(skillDir)) {
          fs.mkdirSync(skillDir, { recursive: true });
        }

        // 读取项目配置获取语言
        const configPath = path.join(projectDir, 'config.json');
        let language: 'zh' | 'en' = 'zh';
        if (fs.existsSync(configPath)) {
          try {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            language = config.language || 'zh';
          } catch {
            // 使用默认语言
          }
        }

        // 复制 SKILL.md
        const skillSource = path.join(pluginRoot, 'locales', language, 'SKILL.md');
        const skillTarget = path.join(skillDir, 'SKILL.md');
        if (fs.existsSync(skillSource)) {
          fs.copyFileSync(skillSource, skillTarget);
          console.log(`  ✓ 已复制 SKILL.md`);
        }

        // 复制命令文档
        const commandsSourceDir = path.join(pluginRoot, 'locales', language, 'commands');
        const commandsTargetDir = path.join(skillDir, 'commands');
        if (fs.existsSync(commandsSourceDir)) {
          if (!fs.existsSync(commandsTargetDir)) {
            fs.mkdirSync(commandsTargetDir, { recursive: true });
          }
          const commandFiles = fs.readdirSync(commandsSourceDir).filter(f => f.endsWith('.md'));
          for (const file of commandFiles) {
            fs.copyFileSync(
              path.join(commandsSourceDir, file),
              path.join(commandsTargetDir, file)
            );
          }
          console.log(`  ✓ 已复制 ${commandFiles.length} 个命令文档`);
        }
      } else {
        console.log(`  ✗ 无法修复: CLAUDE_PLUGIN_ROOT 未设置`);
      }
    } else if (issue.name.startsWith('目录:')) {
      // 创建缺失的目录
      const dirName = issue.name.replace('目录: ', '');
      const dirMap: Record<string, string> = {
        'tasks': getTasksDir(cwd),
        'toolbox': getToolboxDir(cwd),
        'archive': path.join(projectDir, 'archive'),
        'hooks': path.join(projectDir, 'hooks'),
        'bin': path.join(projectDir, 'bin'),
        'reports': path.join(projectDir, 'reports'),
      };

      const dirPath = dirMap[dirName];
      if (dirPath && !fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        console.log(`  ✓ 已创建目录: ${dirName}/`);
      }
    } else if (issue.name === 'Hooks 目录') {
      // 创建 hooks 目录
      const hooksDir = getHooksDir(cwd);
      if (!fs.existsSync(hooksDir)) {
        fs.mkdirSync(hooksDir, { recursive: true });
        console.log(`  ✓ 已创建 hooks 目录`);
      }
    } else if (issue.name.startsWith('Hook: ')) {
      // 创建缺失的 hook 文件
      const hookFile = issue.name.replace('Hook: ', '');
      const hooksDir = getHooksDir(cwd);
      const hookPath = path.join(hooksDir, hookFile);

      if (!fs.existsSync(hooksDir)) {
        fs.mkdirSync(hooksDir, { recursive: true });
      }

      // 创建 hook 文件模板
      const hookTemplates: Record<string, string> = {
        'pre-complete.ts': `#!/usr/bin/env bun
/**
 * 任务完成前验证钩子
 * 在任务状态更新为 resolved/closed 前触发
 */

export default async function preComplete(taskId: string) {
  console.log(\`[pre-complete] 验证任务: \${taskId}\`);
  // 在这里添加验证逻辑
  return true;
}
`,
        'post-task.ts': `#!/usr/bin/env bun
/**
 * 任务执行后钩子
 * 在任务完成后自动调用
 */

export default async function postTask(taskId: string, success: boolean) {
  console.log(\`[post-task] 任务 \${taskId} \${success ? '完成' : '失败'}\`);
  // 在这里添加自定义逻辑
}
`,
      };

      if (hookTemplates[hookFile]) {
        fs.writeFileSync(hookPath, hookTemplates[hookFile], 'utf-8');
        console.log(`  ✓ 已创建 Hook: ${hookFile}`);
      }
    } else if (issue.name === 'Claude Code Hooks 配置') {
      // 配置 .claude/settings.json 中的 hooks
      const claudeDir = path.join(cwd, '.claude');
      const settingsPath = path.join(claudeDir, 'settings.json');
      const hooksDir = getHooksDir(cwd);

      if (!fs.existsSync(claudeDir)) {
        fs.mkdirSync(claudeDir, { recursive: true });
      }

      let settings: Record<string, unknown> = {};
      if (fs.existsSync(settingsPath)) {
        try {
          settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        } catch {
          // 文件格式错误，使用空对象
        }
      }

      // 添加任务验证 hooks 配置
      const taskHooks = {
        'PreToolUse': [
          {
            matcher: 'TaskUpdate',
            hooks: [{ type: 'command', command: `bun run ${hooksDir}/pre-complete.ts` }]
          }
        ],
        'PostToolUse': [
          {
            matcher: 'TaskUpdate|TaskCreate|TaskGet',
            hooks: [{ type: 'command', command: `bun run ${hooksDir}/post-task.ts` }]
          }
        ]
      };

      settings['hooks'] = {
        ...(settings['hooks'] as Record<string, unknown> || {}),
        ...taskHooks,
      };

      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
      console.log(`  ✓ 已配置 Claude Code hooks`);
    }
  }

  console.log('');
  console.log('✅ 修复完成');
}
