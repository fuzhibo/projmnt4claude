import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  isInitialized,
  getProjectDir,
  getTasksDir,
  getToolboxDir,
  getLogsDir,
} from '../utils/path';
import { getAllTaskIds } from '../utils/task';
import { SEPARATOR_WIDTH } from '../utils/format';
import { Logger } from '../utils/logger';
import { readConfig, writeConfig, ensureConfigDefaults } from './config';
import { LogCollector, LogAnalyzerRegistry, AnalysisReporter } from '../utils/log-analyzer';
import { getBuiltInAnalyzers } from '../utils/log-analyzers';
import { Pre } from '../utils/pre';
import { DEFAULT_GIT_HOOK } from '../types/config';

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

    // 5. 检查目录结构完整性
    results.push(...checkDirectoryStructure(cwd));

    // 6. 检查日志模块就绪性
    results.push(...checkLoggingModule(cwd));

    // 8. 检查废弃状态残留
    results.push(...checkDeprecatedStatuses(cwd));

    // 9. 检查 Git Hook 状态
    results.push(...checkGitHooks(cwd));
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
 * 检查日志模块就绪性
 * 包含: logs 目录存在性、logging.* 配置完整性、日志文件健康检查
 */
function checkLoggingModule(cwd: string): CheckResult[] {
  const results: CheckResult[] = [];
  const logsDir = getLogsDir(cwd);

  // CP-12: logs 目录存在性检查
  if (!fs.existsSync(logsDir)) {
    results.push({
      name: '日志目录',
      status: 'warning',
      message: 'logs 目录不存在',
      details: [
        `缺失: ${logsDir}`,
        '请运行 projmnt4claude setup 升级项目结构',
      ],
      fixable: true,
    });
    // 目录不存在时跳过后续日志健康检查
    return results;
  }

  results.push({
    name: '日志目录',
    status: 'ok',
    message: '存在',
    details: [`位置: ${logsDir}`],
    fixable: false,
  });

  // CP-13: logging.* 配置完整性检查
  const config = readConfig(cwd);
  if (config) {
    const loggingConfig = config.logging as Record<string, unknown> | undefined;
    const requiredKeys: Record<string, unknown> = {
      level: 'info',
      maxFiles: 30,
      recordInputs: true,
      inputMaxLength: 500,
    };

    const missingKeys: string[] = [];
    for (const [key, defaultValue] of Object.entries(requiredKeys)) {
      if (!loggingConfig || loggingConfig[key] === undefined) {
        missingKeys.push(`logging.${key} (默认: ${JSON.stringify(defaultValue)})`);
      }
    }

    if (missingKeys.length > 0) {
      results.push({
        name: '日志配置完整性',
        status: 'warning',
        message: `${missingKeys.length} 个日志配置项缺失`,
        details: [
          '缺失的配置项:',
          ...missingKeys.map(k => `  - ${k}`),
          '',
          '💡 运行 projmnt4claude doctor --fix 自动补全默认值',
        ],
        fixable: true,
      });
    } else {
      results.push({
        name: '日志配置完整性',
        status: 'ok',
        message: '所有 logging.* 配置项完整',
        details: [
          `level: ${loggingConfig!.level}`,
          `maxFiles: ${loggingConfig!.maxFiles}`,
          `recordInputs: ${loggingConfig!.recordInputs}`,
          `inputMaxLength: ${loggingConfig!.inputMaxLength}`,
        ],
        fixable: false,
      });
    }

    // 检查 ai 和 training 配置
    const aiConfig = config.ai as Record<string, unknown> | undefined;
    if (!aiConfig || aiConfig.provider === undefined) {
      results.push({
        name: 'AI 配置完整性',
        status: 'warning',
        message: 'ai.provider 配置缺失',
        details: [`默认值: claude-code`, '💡 运行 projmnt4claude doctor --fix 自动补全'],
        fixable: true,
      });
    } else {
      results.push({
        name: 'AI 配置完整性',
        status: 'ok',
        message: `provider: ${aiConfig.provider}`,
        details: aiConfig.customEndpoint ? [`自定义端点: ${aiConfig.customEndpoint}`] : [],
        fixable: false,
      });
    }

    const trainingConfig = config.training as Record<string, unknown> | undefined;
    if (!trainingConfig || trainingConfig.exportEnabled === undefined) {
      results.push({
        name: '训练数据配置完整性',
        status: 'warning',
        message: 'training.* 配置缺失',
        details: ['💡 运行 projmnt4claude doctor --fix 自动补全默认值'],
        fixable: true,
      });
    } else {
      results.push({
        name: '训练数据配置完整性',
        status: 'ok',
        message: `exportEnabled: ${trainingConfig.exportEnabled}`,
        details: [`outputDir: ${trainingConfig.outputDir}`],
        fixable: false,
      });
    }
  }

  // CP-14: 日志健康检查
  const oversizedFiles: string[] = [];
  let totalSizeMB = 0;

  try {
    const files = fs.readdirSync(logsDir).filter(f => f.endsWith('.log'));
    for (const file of files) {
      const filePath = path.join(logsDir, file);
      try {
        const stat = fs.statSync(filePath);
        const sizeMB = stat.size / (1024 * 1024);
        totalSizeMB += sizeMB;
        if (sizeMB > 10) {
          oversizedFiles.push(`${file} (${sizeMB.toFixed(1)}MB)`);
        }
      } catch {
        // 跳过无法读取的文件
      }
    }

    const details: string[] = [];
    let status: 'ok' | 'warning' = 'ok';
    let message = `日志健康 (${files.length} 个文件, ${totalSizeMB.toFixed(1)}MB)`;

    if (oversizedFiles.length > 0) {
      status = 'warning';
      message = `${oversizedFiles.length} 个日志文件超过 10MB`;
      details.push('超过 10MB 的文件:');
      details.push(...oversizedFiles.slice(0, 5).map(f => `  - ${f}`));
    }

    if (totalSizeMB > 100) {
      status = 'warning';
      message = `日志目录总大小超过 100MB (${totalSizeMB.toFixed(1)}MB)`;
      details.push(`建议清理旧日志: projmnt4claude config set logging.maxFiles 15`);
    }

    if (status === 'ok') {
      details.push(`总大小: ${totalSizeMB.toFixed(1)}MB`);
    }

    results.push({
      name: '日志健康',
      status,
      message,
      details,
      fixable: false,
    });
  } catch {
    results.push({
      name: '日志健康',
      status: 'warning',
      message: '无法读取日志目录',
      details: [`路径: ${logsDir}`],
      fixable: false,
    });
  }

  return results;
}

/**
 * 检查废弃状态残留
 * 检测任务 meta.json 中是否包含已废弃的 reopened/needs_human 状态
 */
function checkDeprecatedStatuses(cwd: string): CheckResult[] {
  const results: CheckResult[] = [];
  const tasksDir = getTasksDir(cwd);

  if (!fs.existsSync(tasksDir)) {
    return [{
      name: '废弃状态检测',
      status: 'ok',
      message: '任务目录不存在（无任务）',
      details: [],
      fixable: false,
    }];
  }

  const taskIds = getAllTaskIds(cwd);
  const deprecatedStatuses = ['reopened', 'needs_human'];
  const tasksWithDeprecatedStatus: { taskId: string; status: string }[] = [];

  for (const taskId of taskIds) {
    const metaPath = path.join(tasksDir, taskId, 'meta.json');
    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        if (deprecatedStatuses.includes(meta.status)) {
          tasksWithDeprecatedStatus.push({ taskId, status: meta.status });
        }
      } catch {
        // 忽略解析错误
      }
    }
  }

  if (tasksWithDeprecatedStatus.length === 0) {
    results.push({
      name: '废弃状态检测',
      status: 'ok',
      message: `所有 ${taskIds.length} 个任务无废弃状态残留`,
      details: ['✓ 无 reopened/needs_human 状态'],
      fixable: false,
    });
  } else {
    results.push({
      name: '废弃状态检测',
      status: 'warning',
      message: `${tasksWithDeprecatedStatus.length} 个任务使用废弃状态`,
      details: [
        '废弃状态的任务:',
        ...tasksWithDeprecatedStatus.map(t => `  - ${t.taskId}: status=${t.status}`),
        '',
        '⚠️  废弃说明:',
        '  - reopened (v4 废弃): 应使用 open + reopenCount + transitionNote',
        '  - needs_human (v4 废弃): 应使用 open + resumeAction',
        '',
        '💡 运行 projmnt4claude analyze --fix -y 自动迁移',
      ],
      fixable: true,
    });
  }

  return results;
}

/**
 * 检查 Git Hook 状态
 * 读取 gitHook.enabled 配置决定是否检测
 * 配置禁用时跳过检测，非 git 仓库时自动降级
 */
function checkGitHooks(cwd: string): CheckResult[] {
  const config = readConfig(cwd);
  const gitHookConfig = config?.gitHook ?? DEFAULT_GIT_HOOK;

  // CP-2: 配置禁用时跳过
  if (!gitHookConfig.enabled) {
    return [{ status: 'ok', name: 'Git Hooks', message: 'Git Hook 检测已通过配置禁用', fixable: false }];
  }

  // CP-3: 非 git 仓库时自动降级
  const gitDir = path.join(cwd, '.git');
  if (!fs.existsSync(gitDir)) {
    return [{ status: 'ok', name: 'Git Hooks', message: '非 git 仓库，跳过 Git Hook 检测', fixable: false }];
  }

  // CP-1: 正常检测 git hook 状态
  try {
    const pre = new Pre(cwd);

    if (pre.isPreCommitInstalled()) {
      return [{
        name: 'Git Hooks',
        status: 'ok',
        message: 'pre-commit hook 已安装',
        fixable: false,
      }];
    }

    return [{
      name: 'Git Hooks',
      status: 'warning',
      message: 'pre-commit hook 未安装',
      details: [
        '建议安装 pre-commit hook 以在提交前自动运行测试',
        '运行 projmnt4claude pre install 安装',
      ],
      fixable: false,
    }];
  } catch {
    return [{
      name: 'Git Hooks',
      status: 'warning',
      message: '无法检查 Git Hook 状态',
      fixable: false,
    }];
  }
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
    } else if (issue.name === '日志目录') {
      // 创建 logs 目录
      const logsDir = getLogsDir(cwd);
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
        console.log(`  ✓ 已创建 logs 目录`);
      }
    } else if (issue.name === '日志配置完整性' || issue.name === 'AI 配置完整性' || issue.name === '训练数据配置完整性') {
      // 自动补全缺失的配置项
      const config = readConfig(cwd);
      if (config) {
        const fixedConfig = ensureConfigDefaults(config);
        writeConfig(fixedConfig, cwd);
        console.log(`  ✓ 已自动补全缺失的配置项`);
      }
    } else if (issue.name === '废弃状态检测') {
      // 迁移废弃状态 reopened/needs_human → open
      const tasksDir = getTasksDir(cwd);
      const deprecatedMap: Record<string, string> = { 'reopened': 'open', 'needs_human': 'open' };
      let fixedCount = 0;
      for (const taskId of getAllTaskIds(cwd)) {
        const metaPath = path.join(tasksDir, taskId, 'meta.json');
        if (fs.existsSync(metaPath)) {
          try {
            const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
            if (deprecatedMap[meta.status]) {
              const oldStatus = meta.status;
              meta.status = deprecatedMap[oldStatus];
              if (!meta.transitionNotes) meta.transitionNotes = [];
              meta.transitionNotes.push({
                timestamp: new Date().toISOString(),
                fromStatus: oldStatus,
                toStatus: meta.status,
                note: `doctor --fix: ${oldStatus} 状态已废弃（v4），迁移为 ${meta.status}`,
                author: 'doctor-fix',
              });
              meta.updatedAt = new Date().toISOString();
              fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
              fixedCount++;
            }
          } catch {
            // 忽略解析错误
          }
        }
      }
      console.log(`  ✓ 已迁移 ${fixedCount} 个废弃状态任务`);
    }
  }

  console.log('');
  console.log('✅ 修复完成');
}

/**
 * 生成 Bug 报告
 * 调用 Logger 生成 Markdown 报告 + .tar.gz 日志压缩附件
 */
export async function runBugReport(cwd: string = process.cwd()): Promise<void> {
  console.log('');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('📋 Bug 报告生成');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('');

  if (!isInitialized(cwd)) {
    console.error('❌ 错误: 项目尚未初始化，无法生成 Bug 报告');
    console.error('请先运行 projmnt4claude setup 初始化项目');
    process.exit(1);
  }

  const logger = new Logger({ cwd });

  try {
    // 生成 Bug 报告
    const report = logger.generateBugReport(100);

    // 输出报告
    console.log(report.markdown);
    console.log('');
    console.log('━'.repeat(SEPARATOR_WIDTH));

    // 输出成本汇总
    console.log('');
    console.log('━'.repeat(SEPARATOR_WIDTH));
    console.log('💰 AI 成本汇总');
    console.log('━'.repeat(SEPARATOR_WIDTH));
    console.log('');

    const costSummary = logger.getCostSummary();
    console.log(`总 AI 调用次数: ${costSummary.totalCalls}`);
    console.log(`总耗时: ${(costSummary.totalDurationMs / 1000).toFixed(1)}s`);
    console.log(`总 Tokens: ${costSummary.totalTokens} (输入: ${costSummary.totalInputTokens}, 输出: ${costSummary.totalOutputTokens})`);

    if (Object.keys(costSummary.byField).length > 0) {
      console.log('');
      console.log('按字段分组:');
      for (const [field, info] of Object.entries(costSummary.byField)) {
        console.log(`  ${field}: ${info.calls} 次调用, ${(info.durationMs / 1000).toFixed(1)}s, ${info.totalTokens} tokens`);
      }
    }

    // 输出使用分析
    console.log('');
    console.log('━'.repeat(SEPARATOR_WIDTH));
    console.log('📊 使用分析');
    console.log('━'.repeat(SEPARATOR_WIDTH));
    console.log('');

    const usage = logger.analyzeUsage();
    console.log(`总命令执行次数: ${usage.totalCommands}`);
    console.log(`平均耗时: ${(usage.averageDurationMs / 1000).toFixed(1)}s`);
    console.log(`AI 使用率: ${(usage.aiUsageRate * 100).toFixed(1)}%`);
    console.log(`错误数: ${usage.totalErrors}, 警告数: ${usage.totalWarnings}`);

    if (Object.keys(usage.commandFrequency).length > 0) {
      console.log('');
      console.log('命令使用频率:');
      const sorted = Object.entries(usage.commandFrequency).sort((a, b) => b[1] - a[1]);
      for (const [cmd, count] of sorted) {
        console.log(`  ${cmd}: ${count} 次`);
      }
    }

    if (usage.commonErrors.length > 0) {
      console.log('');
      console.log('常见错误:');
      for (const err of usage.commonErrors.slice(0, 5)) {
        console.log(`  [${err.count}x] ${err.message}`);
      }
    }

    console.log('');
    console.log('━'.repeat(SEPARATOR_WIDTH));
    console.log(`✅ Bug 报告已生成`);
    console.log(`📎 日志压缩附件: ${report.archivePath}`);
  } catch (err) {
    console.error('');
    console.error(`❌ Bug 报告生成失败: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

/**
 * 运行深度诊断（--deep 模式）
 *
 * 在规则快速分析基础上，运行所有日志分析器（规则 + AI 混合策略），
 * 提供更深入的问题检测和修复建议。
 */
export async function runDoctorDeep(cwd: string = process.cwd()): Promise<void> {
  console.log('');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('🔬 深度日志分析 (--deep)');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('');

  // 1. 先运行常规 doctor 检查
  await runDoctor(false, cwd);

  console.log('');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('📊 日志深度分析');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('');

  // 2. 收集日志
  const collector = new LogCollector(cwd);
  const stats = collector.getStats();

  if (stats.fileCount === 0) {
    console.log('ℹ️  未找到日志文件，跳过日志分析');
    console.log(`   日志目录: ${getLogsDir(cwd)}`);
    return;
  }

  console.log(`📂 日志文件: ${stats.fileCount} 个 (${stats.totalSizeKB} KB)`);

  // 收集最近 24 小时的日志
  const entries = collector.collectSince(24, { maxEntries: 10000 });
  console.log(`📋 日志条目: ${entries.length} 条 (最近 24 小时)`);
  console.log('');

  if (entries.length === 0) {
    console.log('ℹ️  最近 24 小时无日志条目');
    return;
  }

  // 3. 注册并运行所有分析器
  const registry = new LogAnalyzerRegistry(cwd);
  for (const analyzer of getBuiltInAnalyzers()) {
    registry.register(analyzer);
  }

  console.log(`🔧 已注册 ${registry.size} 个分析器:`);
  for (const analyzer of registry.getAll()) {
    console.log(`   - ${analyzer.name} (${analyzer.category}) [${analyzer.supportedStrategies.join(', ')}]`);
  }
  console.log('');

  // 使用 hybrid 策略（规则 + AI）
  const results = await registry.runAll(entries, 'hybrid', { cwd, enableAI: true });

  // 4. 生成报告
  const reporter = new AnalysisReporter();
  const report = reporter.buildReport(results, stats.fileCount, entries.length);

  console.log(reporter.formatText(report));

  // 5. 输出建议
  if (report.summary.totalFindings > 0) {
    console.log('━'.repeat(SEPARATOR_WIDTH));
    console.log(`📊 发现 ${report.summary.totalFindings} 个问题`);

    const critical = report.summary.bySeverity['critical'] || 0;
    const errors = report.summary.bySeverity['error'] || 0;
    if (critical > 0) {
      console.log(`🔴 ${critical} 个严重问题需要立即处理`);
    }
    if (errors > 0) {
      console.log(`❌ ${errors} 个错误需要关注`);
    }
  } else {
    console.log('✅ 日志深度分析完成，未发现异常');
  }
}
