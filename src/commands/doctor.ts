import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  isInitialized,
  getProjectDir,
  getTasksDir,
  getToolboxDir,
  getHooksDir,
} from '../utils/path';
import { getAllTaskIds } from '../utils/task';
import { SEPARATOR_WIDTH } from '../utils/format';
import { parseTaskId, TaskIdInfo } from '../types/task';

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
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('🔍 环境诊断');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('');

  const results: CheckResult[] = [];

  // 1. 检查项目初始化状态
  results.push(checkProjectInit(cwd));

  // 2. 检查插件安装作用域（始终检查，不依赖项目初始化状态）
  results.push(...checkPluginInstallationScope(cwd));

  // 只有项目已初始化才检查后续项
  if (isInitialized(cwd)) {
    // 3. 检查插件缓存
    results.push(checkPluginCache());

    // 4. 检查项目技能文件
    results.push(...checkSkillFiles(cwd));

    // 5. 检查任务命名格式
    results.push(...checkTaskNaming(cwd));

    // 6. 检查目录结构完整性
    results.push(...checkDirectoryStructure(cwd));

    // 7. 检查 Hooks 配置
    results.push(...checkHooksConfiguration(cwd));

    // 8. 检查任务规范对齐（检测任务 meta.json 是否符合最新规范）
    results.push(...checkTaskSpecificationAlignment(cwd));

    // 9. Hook 配置已由 checkHooksConfiguration 统一检查
  }

  // 显示结果
  displayResults(results);

  // 如果有可修复的问题且开启了 --fix
  const fixableIssues = results.filter(r => r.status !== 'ok' && r.fixable);
  if (fix && fixableIssues.length > 0) {
    console.log('');
    console.log('━'.repeat(SEPARATOR_WIDTH));
    console.log('🔧 自动修复');
    console.log('━'.repeat(SEPARATOR_WIDTH));
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
      status: 'ok',
      message: 'CLI 模式运行，跳过插件缓存检查',
      details: ['CLAUDE_PLUGIN_ROOT 未设置（CLI 模式下正常）'],
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
      name: '任务命名格式',
      status: 'ok',
      message: '任务目录不存在（无任务）',
      details: [],
      fixable: false,
    }];
  }

  const taskIds = getAllTaskIds(cwd);
  const invalidFormatTasks: string[] = [];
  const typeMismatchTasks: { taskId: string; idType: string; metaType: string }[] = [];

  for (const taskId of taskIds) {
    // 使用 parseTaskId 替代硬编码正则
    const idInfo = parseTaskId(taskId);

    // 检查格式是否合法（valid=true 且 format 为 old 或 new）
    if (!idInfo.valid || (idInfo.format !== 'old' && idInfo.format !== 'new')) {
      invalidFormatTasks.push(taskId);
    }

    // 检查 ID type 与 meta.json type 一致性（仅新格式有 type 信息）
    if (idInfo.valid && idInfo.format === 'new' && idInfo.type) {
      const metaPath = path.join(tasksDir, taskId, 'meta.json');
      if (fs.existsSync(metaPath)) {
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
          if (meta.type && meta.type !== idInfo.type) {
            typeMismatchTasks.push({
              taskId,
              idType: idInfo.type,
              metaType: meta.type,
            });
          }
        } catch {
          // 忽略解析错误
        }
      }
    }
  }

  // 报告 1: 格式不合法
  if (invalidFormatTasks.length === 0) {
    results.push({
      name: '任务命名格式',
      status: 'ok',
      message: `所有 ${taskIds.length} 个任务命名格式正确`,
      details: ['支持格式: TASK-XXX (旧) 或 TASK-{type}-{priority}-{slug}-{date} (新)'],
      fixable: false,
    });
  } else {
    results.push({
      name: '任务命名格式',
      status: 'warning',
      message: `${invalidFormatTasks.length} 个任务命名格式不规范`,
      details: [
        '不规范的命名:',
        ...invalidFormatTasks.slice(0, 5).map(t => `  - ${t}`),
        ...(invalidFormatTasks.length > 5 ? [`  ... 还有 ${invalidFormatTasks.length - 5} 个`] : []),
        '建议格式: TASK-{type}-{priority}-{slug}-{date}',
      ],
      fixable: false, // 任务重命名需要手动处理
    });
  }

  // 报告 2: ID/meta type 不一致
  if (typeMismatchTasks.length > 0) {
    results.push({
      name: '任务类型一致性',
      status: 'warning',
      message: `${typeMismatchTasks.length} 个任务的 ID 类型与 meta.json 不一致`,
      details: [
        '不一致的任务:',
        ...typeMismatchTasks.slice(0, 5).map(t => `  - ${t.taskId}: ID=${t.idType}, meta=${t.metaType}`),
        ...(typeMismatchTasks.length > 5 ? [`  ... 还有 ${typeMismatchTasks.length - 5} 个`] : []),
        '建议: 手动修正 meta.json 中的 type 字段或重命名任务',
      ],
      fixable: false,
    });
  } else if (taskIds.length > 0) {
    // 仅在有任务时报告一致性检查通过
    const newFormatCount = taskIds.filter(id => {
      const info = parseTaskId(id);
      return info.valid && info.format === 'new' && info.type;
    }).length;
    if (newFormatCount > 0) {
      results.push({
        name: '任务类型一致性',
        status: 'ok',
        message: `${newFormatCount} 个新格式任务 ID 与 meta.json 类型一致`,
        details: [],
        fixable: false,
      });
    }
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

  // 检查 archive 目录 - 仅在存在 abandoned 任务时才有意义
  const tasksDir = getTasksDir(cwd);
  if (fs.existsSync(tasksDir)) {
    const taskIds = getAllTaskIds(cwd);
    const hasAbandonedTasks = taskIds.some(taskId => {
      const metaPath = path.join(tasksDir, taskId, 'meta.json');
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        return meta.status === 'abandoned';
      } catch {
        return false;
      }
    });

    if (hasAbandonedTasks) {
      const archiveDir = path.join(projectDir, 'archive');
      if (!fs.existsSync(archiveDir)) {
        results.push({
          name: '目录: archive',
          status: 'warning',
          message: '存在已废弃任务但 archive 目录缺失',
          details: [`缺失: ${archiveDir}`],
          fixable: true,
        });
      }
    }
  }

  return results;
}

/**
 * 检查插件安装作用域问题
 * 检测 project-scope 安装可能导致的其他项目无法更新的问题
 */
function checkPluginInstallationScope(cwd: string): CheckResult[] {
  const results: CheckResult[] = [];
  const homeDir = os.homedir();
  const installedPluginsPath = path.join(homeDir, '.claude', 'plugins', 'installed_plugins.json');

  if (!fs.existsSync(installedPluginsPath)) {
    return results;
  }

  try {
    const pluginsConfig = JSON.parse(fs.readFileSync(installedPluginsPath, 'utf-8'));
    const plugins = pluginsConfig.plugins || {};

    // 查找所有 project-scope 安装的 projmnt4claude
    const pluginKey = 'projmnt4claude@projmnt4claude';
    const installations = plugins[pluginKey] || [];

    const projectScopedInstalls = installations.filter(
      (inst: { scope: string; projectPath?: string }) => inst.scope === 'project'
    );

    if (projectScopedInstalls.length === 0) {
      // 没有发现 project-scope 安装，正常
      return results;
    }

    // 检查当前项目是否是安装项目
    const normalizedCwd = path.resolve(cwd);
    const mismatchedInstalls = projectScopedInstalls.filter(
      (inst: { scope: string; projectPath?: string }) => {
        if (!inst.projectPath) return true;
        return path.resolve(inst.projectPath) !== normalizedCwd;
      }
    );

    if (mismatchedInstalls.length > 0) {
      const mismatchedList = mismatchedInstalls.map(
        (inst: { scope: string; projectPath?: string; version?: string }) =>
          `  - 版本 ${inst.version || '未知'} 绑定到: ${inst.projectPath || '未知路径'}`
      ).join('\n');

      results.push({
        name: '插件安装作用域',
        status: 'warning',
        message: '检测到 project-scope 安装可能导致跨项目更新问题',
        details: [
          'projmnt4claude 以 project-scope 安装在以下项目:',
          mismatchedList,
          '',
          '⚠️  问题说明:',
          '  Claude Code 的 project-scope 插件绑定到特定项目路径。',
          '  从其他项目尝试更新时会报错: "Plugin is not installed at scope project"',
          '',
          '💡 建议解决方案:',
          '  1. 卸载现有安装:',
          '     claude plugins uninstall projmnt4claude@projmnt4claude',
          '',
          '  2. 以 user-scope 重新安装 (推荐):',
          '     claude plugins install projmnt4claude@projmnt4claude --scope user',
          '',
          '  或者从原安装项目更新:',
          `     cd ${mismatchedInstalls[0].projectPath || '<原项目路径>'}`,
          '     claude plugins update projmnt4claude@projmnt4claude',
        ],
        fixable: false, // 需要用户手动操作
      });
    } else if (projectScopedInstalls.length > 0) {
      // 当前项目匹配，但提醒 user-scope 更好
      results.push({
        name: '插件安装作用域',
        status: 'warning',
        message: '建议使用 user-scope 安装以便跨项目使用',
        details: [
          '当前项目已正确绑定 project-scope 安装',
          '但建议使用 user-scope 以便在所有项目中使用:',
          '',
          '  claude plugins uninstall projmnt4claude@projmnt4claude',
          '  claude plugins install projmnt4claude@projmnt4claude --scope user',
        ],
        fixable: false,
      });
    }
  } catch {
    // 忽略解析错误
  }

  return results;
}

/**
 * 检查任务规范对齐
 * 检测任务 meta.json 是否符合最新规范（reopenCount, requirementHistory 等字段）
 */
function checkTaskSpecificationAlignment(cwd: string): CheckResult[] {
  const results: CheckResult[] = [];
  const tasksDir = getTasksDir(cwd);

  if (!fs.existsSync(tasksDir)) {
    return [{
      name: '任务规范对齐',
      status: 'ok',
      message: '任务目录不存在（无任务）',
      details: [],
      fixable: false,
    }];
  }

  const taskIds = getAllTaskIds(cwd);
  const tasksNeedingMigration: string[] = [];

  for (const taskId of taskIds) {
    const metaPath = path.join(tasksDir, taskId, 'meta.json');
    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        // 检查是否缺少新规范字段
        if (meta.reopenCount === undefined || meta.requirementHistory === undefined) {
          tasksNeedingMigration.push(taskId);
        }
      } catch {
        // 忽略解析错误
      }
    }
  }

  if (tasksNeedingMigration.length === 0) {
    results.push({
      name: '任务规范对齐',
      status: 'ok',
      message: `所有 ${taskIds.length} 个任务符合最新规范`,
      details: ['✓ reopenCount 字段已设置', '✓ requirementHistory 字段已设置'],
      fixable: false,
    });
  } else {
    results.push({
      name: '任务规范对齐',
      status: 'warning',
      message: `${tasksNeedingMigration.length} 个任务需要迁移到最新规范`,
      details: [
        '缺少字段: reopenCount, requirementHistory',
        '需要迁移的任务:',
        ...tasksNeedingMigration.slice(0, 5).map(t => `  - ${t}`),
        ...(tasksNeedingMigration.length > 5 ? [`  ... 还有 ${tasksNeedingMigration.length - 5} 个`] : []),
        '',
        '💡 运行 projmnt4claude analyze --fix -y 自动迁移',
      ],
      fixable: true,
    });
  }

  return results;
}

/**
 * 检查 Hooks 配置
 */
function checkHooksConfiguration(cwd: string): CheckResult[] {
  const results: CheckResult[] = [];
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
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log(`📊 汇总: ${errorCount} 错误, ${warningCount} 警告, ${okCount} 正常`);

  if (errorCount === 0 && warningCount === 0) {
    console.log('✅ 所有检查通过！');
  }
}

/**
 * 解析插件根目录
 * 优先使用 CLAUDE_PLUGIN_ROOT 环境变量（插件模式）
 * 回退到相对于当前文件的包根目录（CLI/开发模式）
 */
function resolvePluginRoot(): string | null {
  // 1. 插件模式 - Claude Code 注入的环境变量
  if (process.env.CLAUDE_PLUGIN_ROOT) {
    return process.env.CLAUDE_PLUGIN_ROOT;
  }

  // 2. CLI/开发模式 - 从当前文件位置向上查找包含 locales 的目录
  try {
    let dir = __dirname;
    for (let i = 0; i < 3; i++) {
      if (fs.existsSync(path.join(dir, 'locales'))) {
        return dir;
      }
      dir = path.dirname(dir);
    }
  } catch {
    // 忽略路径解析错误
  }

  return null;
}

/**
 * 修复问题
 */
async function fixIssues(issues: CheckResult[], cwd: string): Promise<void> {
  const projectDir = getProjectDir(cwd);
  const pluginRoot = resolvePluginRoot();

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
        console.log(`  ✗ 无法修复: 未找到插件根目录（CLAUDE_PLUGIN_ROOT 未设置且无法自动定位）`);
      }
    } else if (issue.name.startsWith('目录:')) {
      // 创建缺失的目录
      const dirName = issue.name.replace('目录: ', '');
      const dirMap: Record<string, string> = {
        'tasks': getTasksDir(cwd),
        'toolbox': getToolboxDir(cwd),
        'archive': path.join(projectDir, 'archive'),
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
 *
 * Claude Code hooks 通过 stdin 传递 JSON 数据
 * 必须返回 JSON: { allowed: true/false, reason?: string }
 */

async function main() {
  // 从 stdin 读取输入
  let input = {};
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    const data = Buffer.concat(chunks).toString();
    if (data.trim()) {
      input = JSON.parse(data);
    }
  } catch {
    // 忽略解析错误
  }

  const toolInput = (input as any).tool_input || {};
  const newStatus = toolInput.status;

  // 只在任务即将完成时验证
  if (!newStatus || !['resolved', 'closed'].includes(newStatus)) {
    console.log(JSON.stringify({ allowed: true }));
    process.exit(0);
  }

  // 在这里添加自定义验证逻辑
  console.log(JSON.stringify({ allowed: true }));
  process.exit(0);
}

main().catch(() => {
  console.log(JSON.stringify({ allowed: true }));
  process.exit(0);
});
`,
        'post-task.ts': `#!/usr/bin/env bun
/**
 * 任务执行后钩子
 * 在任务工具调用后触发
 *
 * Claude Code hooks 通过 stdin 传递 JSON 数据
 */

async function main() {
  // 从 stdin 读取输入
  let input = {};
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    const data = Buffer.concat(chunks).toString();
    if (data.trim()) {
      input = JSON.parse(data);
    }
  } catch {
    // 忽略解析错误
  }

  const toolName = (input as any).tool_name || '';
  const toolInput = (input as any).tool_input || {};

  // 只处理任务相关的工具调用
  if (toolName.startsWith('Task')) {
    const taskId = toolInput.taskId;
    if (taskId) {
      console.log(\`[post-task] 任务 \${taskId} 操作完成 (\${toolName})\`);
    }
  }

  process.exit(0);
}

main().catch(() => {
  process.exit(0);
});
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
