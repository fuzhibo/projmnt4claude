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
import { t } from '../i18n';

/**
 * Check result interface
 */
interface CheckResult {
  name: string;
  status: 'ok' | 'warning' | 'error';
  message: string;
  details?: string[];
  fixable: boolean;
}

/**
 * Run environment diagnostics
 */
export async function runDoctor(fix: boolean = false, cwd: string = process.cwd()): Promise<void> {
  const texts = t(cwd).doctorCmd;
  console.log('');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('🔍 ' + texts.environmentDiagnostics);
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('');

  const results: CheckResult[] = [];

  // 1. Check project initialization status
  results.push(checkProjectInit(cwd));

  // 2. Check plugin installation scope (always check, doesn't depend on project init)
  results.push(...checkPluginInstallationScope(cwd));

  // Only check subsequent items if project is initialized
  if (isInitialized(cwd)) {
    // 3. Check plugin cache
    results.push(checkPluginCache(cwd));

    // 4. Check project skill files
    results.push(...checkSkillFiles(cwd));

    // 5. Check directory structure integrity
    results.push(...checkDirectoryStructure(cwd));

    // 6. Check logging module readiness
    results.push(...checkLoggingModule(cwd));

    // 8. Check deprecated status remnants
    results.push(...checkDeprecatedStatuses(cwd));

    // 9. Check Git Hook status
    results.push(...checkGitHooks(cwd));

    // 10. Check deprecated Claude Code Hook remnants
    results.push(...checkDeprecatedHooks(cwd));
  }

  // Display results
  displayResults(results, cwd);

  // If there are fixable issues and --fix is enabled
  const fixableIssues = results.filter(r => r.status !== 'ok' && r.fixable);
  if (fix && fixableIssues.length > 0) {
    console.log('');
    console.log('━'.repeat(SEPARATOR_WIDTH));
    console.log('🔧 ' + texts.autoFix);
    console.log('━'.repeat(SEPARATOR_WIDTH));
    console.log('');

    await fixIssues(fixableIssues, cwd);

    // Re-checking
    console.log('');
    console.log('🔄 ' + texts.reChecking);
    console.log('');
    await runDoctor(false, cwd);
    return;
  } else if (fixableIssues.length > 0) {
    console.log('');
    console.log(`💡 ${texts.useFixToAutoFix.replace('{count}', String(fixableIssues.length))}`);
  }
}

/**
 * Check project initialization status
 */
function checkProjectInit(cwd: string): CheckResult {
  const texts = t(cwd).doctorCmd;
  const projectDir = getProjectDir(cwd);
  const configPath = path.join(projectDir, 'config.json');

  if (!fs.existsSync(configPath)) {
    return {
      name: texts.checkProjectInit,
      status: 'error',
      message: texts.checkProjectInitNotInitialized,
      details: [texts.checkProjectInitRunSetup],
      fixable: false,
    };
  }

  return {
    name: texts.checkProjectInit,
    status: 'ok',
    message: texts.checkProjectInitInitialized,
    details: [`Config file: ${configPath}`],
    fixable: false,
  };
}

/**
 * Check plugin cache
 */
function checkPluginCache(cwd: string): CheckResult {
  const texts = t(cwd).doctorCmd;
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
  const details: string[] = [];
  let status: 'ok' | 'warning' | 'error' = 'ok';
  let message = texts.checkPluginCacheNormal;

  if (!pluginRoot) {
    return {
      name: texts.checkPluginCache,
      status: 'ok',
      message: texts.checkPluginCacheCliMode,
      details: ['CLAUDE_PLUGIN_ROOT not set (normal in CLI mode)'],
      fixable: false,
    };
  }

  details.push(`Plugin root: ${pluginRoot}`);

  // Check main file
  const mainFile = path.join(pluginRoot, 'dist', 'projmnt4claude.js');
  if (!fs.existsSync(mainFile)) {
    status = 'error';
    message = texts.checkPluginCacheMainFileMissing;
    details.push(`Missing: ${mainFile}`);
  } else {
    details.push(`✓ Main program: ${mainFile}`);
  }

  // Check locales directory
  const localesDir = path.join(pluginRoot, 'locales');
  if (!fs.existsSync(localesDir)) {
    if (status !== 'error') {
      status = 'warning';
      message = texts.checkPluginCacheLocalesMissing;
    }
    details.push(`Missing: ${localesDir}`);
  } else {
    // Check language directories
    const zhDir = path.join(localesDir, 'zh');
    const enDir = path.join(localesDir, 'en');

    if (fs.existsSync(zhDir)) {
      details.push('✓ Chinese language pack: locales/zh/');
    }
    if (fs.existsSync(enDir)) {
      details.push('✓ English language pack: locales/en/');
    }

    if (!fs.existsSync(zhDir) && !fs.existsSync(enDir)) {
      if (status !== 'error') {
        status = 'warning';
        message = 'Language pack directories missing';
      }
      details.push('Warning: No language pack directories found');
    }
  }

  // Check commands directory
  const commandsDir = path.join(pluginRoot, 'commands');
  if (!fs.existsSync(commandsDir)) {
    if (status !== 'error') {
      status = 'warning';
      message = texts.checkPluginCacheCommandsMissing;
    }
    details.push(`Missing: ${commandsDir}`);
  } else {
    const commandFiles = fs.readdirSync(commandsDir).filter(f => f.endsWith('.md'));
    details.push(`✓ Slash commands: ${commandFiles.length}`);
  }

  return {
    name: texts.checkPluginCache,
    status,
    message,
    details,
    fixable: false,
  };
}

/**
 * Check project skill files
 */
function checkSkillFiles(cwd: string): CheckResult[] {
  const texts = t(cwd).doctorCmd;
  const results: CheckResult[] = [];
  const toolboxDir = getToolboxDir(cwd);
  const skillDir = path.join(toolboxDir, 'projmnt4claude');

  // Check commands directory
  const commandsDir = path.join(skillDir, 'commands');
  if (fs.existsSync(commandsDir)) {
    const commandFiles = fs.readdirSync(commandsDir).filter(f => f.endsWith('.md'));
    results.push({
      name: texts.checkSkillFiles,
      status: 'ok',
      message: texts.checkSkillFilesCount.replace('{count}', String(commandFiles.length)),
      details: [`Location: ${commandsDir}`],
      fixable: false,
    });
  } else {
    results.push({
      name: texts.checkSkillFiles,
      status: 'warning',
      message: texts.checkSkillFilesMissing,
      details: [texts.checkSkillFilesReRunSetup],
      fixable: true,
    });
  }

  return results;
}

/**
 * Check directory structure integrity
 */
function checkDirectoryStructure(cwd: string): CheckResult[] {
  const texts = t(cwd).doctorCmd;
  const results: CheckResult[] = [];
  const projectDir = getProjectDir(cwd);

  const requiredDirs = [
    { name: 'tasks', path: getTasksDir(cwd) },
    { name: 'toolbox', path: getToolboxDir(cwd) },
  ];

  // Check required directories
  for (const dir of requiredDirs) {
    if (!fs.existsSync(dir.path)) {
      results.push({
        name: texts.checkDirectoryStructure.replace('{name}', dir.name),
        status: 'error',
        message: texts.checkDirectoryMissing,
        details: [`Missing: ${dir.path}`],
        fixable: true,
      });
    } else {
      results.push({
        name: texts.checkDirectoryStructure.replace('{name}', dir.name),
        status: 'ok',
        message: texts.checkDirectoryExists,
        details: [],
        fixable: false,
      });
    }
  }

  // Check archive directory - only meaningful when abandoned tasks exist
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
          name: texts.checkDirectoryStructure.replace('{name}', 'archive'),
          status: 'warning',
          message: texts.checkArchiveMissing,
          details: [`Missing: ${archiveDir}`],
          fixable: true,
        });
      }
    }
  }

  return results;
}

/**
 * Check plugin installation scope issues
 * Detects project-scope installation issues that may prevent updates from other projects
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

    // Find all project-scope installations of projmnt4claude
    const pluginKey = 'projmnt4claude@projmnt4claude';
    const installations = plugins[pluginKey] || [];

    const projectScopedInstalls = installations.filter(
      (inst: { scope: string; projectPath?: string }) => inst.scope === 'project'
    );

    if (projectScopedInstalls.length === 0) {
      // No project-scope installation found, normal
      return results;
    }

    // Check if current project is the installation project
    const normalizedCwd = path.resolve(cwd);
    const mismatchedInstalls = projectScopedInstalls.filter(
      (inst: { scope: string; projectPath?: string }) => {
        if (!inst.projectPath) return true;
        return path.resolve(inst.projectPath) !== normalizedCwd;
      }
    );

    if (mismatchedInstalls.length > 0) {
      const texts = t(cwd).doctorCmd;
      const mismatchedList = mismatchedInstalls.map(
        (inst: { scope: string; projectPath?: string; version?: string }) =>
          `  - Version ${inst.version || 'unknown'} bound to: ${inst.projectPath || 'unknown path'}`
      ).join('\n');

      results.push({
        name: texts.checkPluginScope,
        status: 'warning',
        message: texts.checkPluginScopeWarning,
        details: [
          'projmnt4claude installed with project-scope in:',
          mismatchedList,
          '',
          '⚠️  Issue:',
          '  Claude Code project-scope plugins are bound to specific project paths.',
          '  Updating from other projects will fail: "Plugin is not installed at scope project"',
          '',
          '💡 Recommended Solution:',
          '  1. Uninstall existing installation:',
          '     claude plugins uninstall projmnt4claude@projmnt4claude',
          '',
          '  2. Re-install with user-scope (recommended):',
          '     claude plugins install projmnt4claude@projmnt4claude --scope user',
          '',
          '  Or update from the original project:',
          `     cd ${mismatchedInstalls[0].projectPath || '<original-project-path>'}`,
          '     claude plugins update projmnt4claude@projmnt4claude',
        ],
        fixable: false, // Requires manual user action
      });
    } else if (projectScopedInstalls.length > 0) {
      // Current project matches, but suggest user-scope
      const texts = t(cwd).doctorCmd;
      results.push({
        name: texts.checkPluginScope,
        status: 'warning',
        message: texts.checkPluginScopeRecommendUserScope,
        details: [
          'Current project is correctly bound to project-scope installation',
          'But user-scope is recommended for use in all projects:',
          '',
          '  claude plugins uninstall projmnt4claude@projmnt4claude',
          '  claude plugins install projmnt4claude@projmnt4claude --scope user',
        ],
        fixable: false,
      });
    }
  } catch {
    // Ignore parse errors
  }

  return results;
}

/**
 * Check logging module readiness
 * Includes: logs directory existence, logging.* config completeness, log file health check
 */
function checkLoggingModule(cwd: string): CheckResult[] {
  const texts = t(cwd).doctorCmd;
  const results: CheckResult[] = [];
  const logsDir = getLogsDir(cwd);

  // CP-12: logs directory existence check
  if (!fs.existsSync(logsDir)) {
    results.push({
      name: texts.checkLogDirectory,
      status: 'warning',
      message: texts.checkLogDirectoryMissing,
      details: [
        `Missing: ${logsDir}`,
        'Run projmnt4claude setup to upgrade project structure',
      ],
      fixable: true,
    });
    // Skip subsequent log health checks when directory doesn't exist
    return results;
  }

  results.push({
    name: texts.checkLogDirectory,
    status: 'ok',
    message: texts.checkLogDirectoryExists,
    details: [`Location: ${logsDir}`],
    fixable: false,
  });

  // CP-13: logging.* config completeness check
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
        missingKeys.push(`logging.${key} (default: ${JSON.stringify(defaultValue)})`);
      }
    }

    if (missingKeys.length > 0) {
      results.push({
        name: texts.checkLogConfigCompleteness,
        status: 'warning',
        message: texts.checkLogConfigMissing.replace('{count}', String(missingKeys.length)),
        details: [
          'Missing config items:',
          ...missingKeys.map(k => `  - ${k}`),
          '',
          '💡 Run projmnt4claude doctor --fix to auto-fill defaults',
        ],
        fixable: true,
      });
    } else {
      results.push({
        name: texts.checkLogConfigCompleteness,
        status: 'ok',
        message: texts.checkLogConfigComplete,
        details: [
          `level: ${loggingConfig!.level}`,
          `maxFiles: ${loggingConfig!.maxFiles}`,
          `recordInputs: ${loggingConfig!.recordInputs}`,
          `inputMaxLength: ${loggingConfig!.inputMaxLength}`,
        ],
        fixable: false,
      });
    }

    // Check ai and training config
    const aiConfig = config.ai as Record<string, unknown> | undefined;
    if (!aiConfig || aiConfig.provider === undefined) {
      results.push({
        name: texts.checkAiConfigCompleteness,
        status: 'warning',
        message: texts.checkAiConfigMissing,
        details: [`Default: claude-code`, '💡 Run projmnt4claude doctor --fix to auto-fill'],
        fixable: true,
      });
    } else {
      results.push({
        name: texts.checkAiConfigCompleteness,
        status: 'ok',
        message: `provider: ${aiConfig.provider}`,
        details: aiConfig.customEndpoint ? [`Custom endpoint: ${aiConfig.customEndpoint}`] : [],
        fixable: false,
      });
    }

    const trainingConfig = config.training as Record<string, unknown> | undefined;
    if (!trainingConfig || trainingConfig.exportEnabled === undefined) {
      results.push({
        name: texts.checkTrainingConfigCompleteness,
        status: 'warning',
        message: texts.checkTrainingConfigMissing,
        details: ['💡 Run projmnt4claude doctor --fix to auto-fill defaults'],
        fixable: true,
      });
    } else {
      results.push({
        name: texts.checkTrainingConfigCompleteness,
        status: 'ok',
        message: `exportEnabled: ${trainingConfig.exportEnabled}`,
        details: [`outputDir: ${trainingConfig.outputDir}`],
        fixable: false,
      });
    }
  }

  // CP-14: Log health check
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
        // Skip unreadable files
      }
    }

    const details: string[] = [];
    let status: 'ok' | 'warning' = 'ok';
    let message = `Log health (${files.length} files, ${totalSizeMB.toFixed(1)}MB)`;

    if (oversizedFiles.length > 0) {
      status = 'warning';
      message = texts.checkLogHealthOversized.replace('{count}', String(oversizedFiles.length));
      details.push('Files over 10MB:');
      details.push(...oversizedFiles.slice(0, 5).map(f => `  - ${f}`));
    }

    if (totalSizeMB > 100) {
      status = 'warning';
      message = texts.checkLogHealthTotalSize.replace('{size}', totalSizeMB.toFixed(1));
      details.push(`Consider cleaning old logs: projmnt4claude config set logging.maxFiles 15`);
    }

    if (status === 'ok') {
      details.push(`Total size: ${totalSizeMB.toFixed(1)}MB`);
    }

    results.push({
      name: texts.checkLogHealth,
      status,
      message,
      details,
      fixable: false,
    });
  } catch {
    results.push({
      name: texts.checkLogHealth,
      status: 'warning',
      message: 'Cannot read log directory',
      details: [`Path: ${logsDir}`],
      fixable: false,
    });
  }

  return results;
}

/**
 * Check deprecated status remnants
 * Detects if task meta.json contains deprecated reopened/needs_human statuses
 */
function checkDeprecatedStatuses(cwd: string): CheckResult[] {
  const texts = t(cwd).doctorCmd;
  const results: CheckResult[] = [];
  const tasksDir = getTasksDir(cwd);

  if (!fs.existsSync(tasksDir)) {
    return [{
      name: texts.checkDeprecatedStatus,
      status: 'ok',
      message: 'Task directory does not exist (no tasks)',
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
        // Ignore parse errors
      }
    }
  }

  if (tasksWithDeprecatedStatus.length === 0) {
    results.push({
      name: texts.checkDeprecatedStatus,
      status: 'ok',
      message: texts.checkDeprecatedStatusOk.replace('{count}', String(taskIds.length)),
      details: ['✓ No reopened/needs_human status'],
      fixable: false,
    });
  } else {
    results.push({
      name: texts.checkDeprecatedStatus,
      status: 'warning',
      message: texts.checkDeprecatedStatusFound.replace('{count}', String(tasksWithDeprecatedStatus.length)),
      details: [
        'Tasks with deprecated status:',
        ...tasksWithDeprecatedStatus.map(t => `  - ${t.taskId}: status=${t.status}`),
        '',
        '⚠️  Deprecation notice:',
        '  - reopened (deprecated in v4): Use open + reopenCount + transitionNote',
        '  - needs_human (deprecated in v4): Use open + resumeAction',
        '',
        '💡 Run projmnt4claude analyze --fix -y to auto-migrate',
      ],
      fixable: true,
    });
  }

  return results;
}

/**
 * Check Git Hook status
 * Reads gitHook.enabled config to decide whether to check
 * Skips check when disabled in config, auto-degrades when not a git repo
 */
function checkGitHooks(cwd: string): CheckResult[] {
  const texts = t(cwd).doctorCmd;
  const config = readConfig(cwd);
  const gitHookConfig = config?.gitHook ?? DEFAULT_GIT_HOOK;

  // CP-2: Skip if disabled in config
  if (!gitHookConfig.enabled) {
    return [{ status: 'ok', name: texts.checkGitHooks, message: texts.checkGitHooksDisabled, fixable: false }];
  }

  // CP-3: Auto-degrade if not a git repo
  const gitDir = path.join(cwd, '.git');
  if (!fs.existsSync(gitDir)) {
    return [{ status: 'ok', name: texts.checkGitHooks, message: texts.checkGitHooksNotGitRepo, fixable: false }];
  }

  // CP-1: Normal git hook status check
  try {
    const pre = new Pre(cwd);

    if (pre.isPreCommitInstalled()) {
      return [{
        name: texts.checkGitHooks,
        status: 'ok',
        message: texts.checkGitHooksInstalled,
        fixable: false,
      }];
    }

    return [{
      name: texts.checkGitHooks,
      status: 'warning',
      message: texts.checkGitHooksNotInstalled,
      details: [
        'Recommended to install pre-commit hook to run tests before commits',
        'Run: projmnt4claude pre install',
      ],
      fixable: false,
    }];
  } catch {
    return [{
      name: texts.checkGitHooks,
      status: 'warning',
      message: 'Cannot check Git Hook status',
      fixable: false,
    }];
  }
}

/**
 * List of deprecated hook script file names
 */
const DEPRECATED_HOOK_SCRIPTS = ['pre-complete.ts', 'post-task.ts', 'pre-task.ts', 'plan-complete.ts', 'config.json'];

/**
 * Check for deprecated Claude Code Hook remnants
 * Detects hooks field in .claude/settings.json and .projmnt4claude/hooks/ directory
 */
function checkDeprecatedHooks(cwd: string): CheckResult[] {
  const results: CheckResult[] = [];
  const deprecatedSettings: string[] = [];
  const deprecatedFiles: string[] = [];

  // 1. Check deprecated hooks in .claude/settings.json
  const settingsPath = path.join(cwd, '.claude', 'settings.json');
  if (fs.existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      const hooks = settings.hooks || {};

      // Check all hook types
      for (const [hookType, hookConfig] of Object.entries(hooks)) {
        if (typeof hookConfig === 'string') {
          // Simple string format
          if (hookConfig.includes('projmnt4claude/hooks/')) {
            deprecatedSettings.push(`${hookType}: ${hookConfig}`);
          }
        } else if (Array.isArray(hookConfig)) {
          // Array format
          for (const item of hookConfig) {
            if (typeof item === 'string' && item.includes('projmnt4claude/hooks/')) {
              deprecatedSettings.push(`${hookType}[]: ${item}`);
            } else if (typeof item === 'object' && item !== null) {
              const hookItem = item as { command?: string; script?: string; run?: string };
              const hookValue = hookItem.command || hookItem.script || hookItem.run || '';
              if (hookValue.includes('projmnt4claude/hooks/')) {
                deprecatedSettings.push(`${hookType}: ${hookValue}`);
              }
            }
          }
        } else if (typeof hookConfig === 'object' && hookConfig !== null) {
          // Object format
          const hookObj = hookConfig as { command?: string; script?: string; run?: string };
          const hookValue = hookObj.command || hookObj.script || hookObj.run || '';
          if (hookValue.includes('projmnt4claude/hooks/')) {
            deprecatedSettings.push(`${hookType}: ${hookValue}`);
          }
        }
      }
    } catch {
      // Ignore parse errors
    }
  }

  // 2. Check .projmnt4claude/hooks/ directory for deprecated scripts
  const hooksDir = path.join(cwd, '.projmnt4claude', 'hooks');
  if (fs.existsSync(hooksDir)) {
    try {
      const files = fs.readdirSync(hooksDir);
      for (const file of files) {
        if (DEPRECATED_HOOK_SCRIPTS.includes(file)) {
          deprecatedFiles.push(file);
        }
      }
    } catch {
      // Ignore directory read errors
    }
  }

  // 3. Generate check results
  const texts = t(cwd).doctorCmd;
  const hasSettingsIssue = deprecatedSettings.length > 0;
  const hasFilesIssue = deprecatedFiles.length > 0;

  if (hasSettingsIssue || hasFilesIssue) {
    const details: string[] = ['Deprecated Claude Code Hook config found, run doctor --fix to clean'];

    if (hasSettingsIssue) {
      details.push('');
      details.push('Deprecated hooks in .claude/settings.json:');
      for (const setting of deprecatedSettings) {
        details.push(`  - ${setting}`);
      }
    }

    if (hasFilesIssue) {
      details.push('');
      details.push(`Deprecated scripts in .projmnt4claude/hooks/:`);
      for (const file of deprecatedFiles) {
        details.push(`  - ${file}`);
      }
    }

    details.push('');
    details.push('⚠️  Deprecation notice:');
    details.push('  Claude Code Hook feature has been removed, residual config may cause issues');
    details.push('');
    details.push('💡 Run projmnt4claude doctor --fix to auto-clean');

    results.push({
      name: texts.checkDeprecatedHooks,
      status: 'warning',
      message: texts.checkDeprecatedHooksFound,
      details,
      fixable: true,
    });
  } else {
    results.push({
      name: texts.checkDeprecatedHooks,
      status: 'ok',
      message: texts.checkDeprecatedHooksOk,
      details: [],
      fixable: false,
    });
  }

  return results;
}

/**
 * Display check results
 */
function displayResults(results: CheckResult[], cwd: string = process.cwd()): void {
  const texts = t(cwd).doctorCmd;
  // Sort by status: error > warning > ok
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
  console.log('📊 ' + texts.summary.replace('{errors}', String(errorCount)).replace('{warnings}', String(warningCount)).replace('{ok}', String(okCount)));

  if (errorCount === 0 && warningCount === 0) {
    console.log('✅ ' + texts.allChecksPassed);
  }
}

/**
 * Resolve plugin root directory
 * Priority: CLAUDE_PLUGIN_ROOT env var (plugin mode)
 * Fallback: package root relative to current file (CLI/dev mode)
 */
function resolvePluginRoot(): string | null {
  // 1. Plugin mode - env var injected by Claude Code
  if (process.env.CLAUDE_PLUGIN_ROOT) {
    return process.env.CLAUDE_PLUGIN_ROOT;
  }

  // 2. CLI/dev mode - search upward from current file for directory containing locales
  try {
    let dir = __dirname;
    for (let i = 0; i < 3; i++) {
      if (fs.existsSync(path.join(dir, 'locales'))) {
        return dir;
      }
      dir = path.dirname(dir);
    }
  } catch {
    // Ignore path resolution errors
  }

  return null;
}

/**
 * Fix issues
 */
async function fixIssues(issues: CheckResult[], cwd: string): Promise<void> {
  const texts = t(cwd).doctorCmd;
  const projectDir = getProjectDir(cwd);
  const pluginRoot = resolvePluginRoot();

  for (const issue of issues) {
    console.log(texts.fixing.replace('{name}', issue.name));

    if (issue.name === 'Skill Files' || issue.name === 'Command Docs') {
      // Re-copy skill files
      if (pluginRoot) {
        const toolboxDir = getToolboxDir(cwd);
        const skillDir = path.join(toolboxDir, 'projmnt4claude');

        // Create directory
        if (!fs.existsSync(skillDir)) {
          fs.mkdirSync(skillDir, { recursive: true });
        }

        // Read project config for language
        const configPath = path.join(projectDir, 'config.json');
        let language: 'zh' | 'en' = 'zh';
        if (fs.existsSync(configPath)) {
          try {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            language = config.language || 'zh';
          } catch {
            // Use default language
          }
        }

        // Copy SKILL.md
        const skillSource = path.join(pluginRoot, 'locales', language, 'SKILL.md');
        const skillTarget = path.join(skillDir, 'SKILL.md');
        if (fs.existsSync(skillSource)) {
          fs.copyFileSync(skillSource, skillTarget);
          console.log(texts.copiedSkillMd);
        }

        // Copy command docs
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
          console.log(texts.copiedCommandDocs.replace('{count}', String(commandFiles.length)));
        }
      } else {
        console.log(texts.cannotFixPluginRootNotFound);
      }
    } else if (issue.name.startsWith('Directory:')) {
      // Create missing directories
      const dirName = issue.name.replace('Directory: ', '');
      const dirMap: Record<string, string> = {
        'tasks': getTasksDir(cwd),
        'toolbox': getToolboxDir(cwd),
        'archive': path.join(projectDir, 'archive'),
      };

      const dirPath = dirMap[dirName];
      if (dirPath && !fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        console.log(texts.createdDirectory.replace('{name}', dirName));
      }
    } else if (issue.name === texts.checkLogDirectory) {
      // Create logs directory
      const logsDir = getLogsDir(cwd);
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
        console.log(texts.createdLogsDirectory);
      }
    } else if (issue.name === texts.checkLogConfigCompleteness || issue.name === texts.checkAiConfigCompleteness || issue.name === texts.checkTrainingConfigCompleteness) {
      // Auto-fill missing config items
      const config = readConfig(cwd);
      if (config) {
        const fixedConfig = ensureConfigDefaults(config);
        writeConfig(fixedConfig, cwd);
        console.log(texts.autoFilledMissingConfig);
      }
    } else if (issue.name === texts.checkDeprecatedStatus) {
      // Migrate deprecated statuses reopened/needs_human → open
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
                note: `doctor --fix: ${oldStatus} status deprecated (v4), migrated to ${meta.status}`,
                author: 'doctor-fix',
              });
              meta.updatedAt = new Date().toISOString();
              fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
              fixedCount++;
            }
          } catch {
            // Ignore parse errors
          }
        }
      }
      console.log(texts.migratedDeprecatedStatusTasks.replace('{count}', String(fixedCount)));
    } else if (issue.name === texts.checkDeprecatedHooks) {
      // Clean up deprecated Claude Code Hook config
      let removedSettings = false;
      let removedFiles = false;

      // 1. Clean deprecated hooks from .claude/settings.json
      const settingsPath = path.join(cwd, '.claude', 'settings.json');
      if (fs.existsSync(settingsPath)) {
        try {
          const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
          const hooks = settings.hooks || {};
          let modified = false;

          for (const [hookType, hookConfig] of Object.entries(hooks)) {
            let shouldRemove = false;

            if (typeof hookConfig === 'string') {
              if (hookConfig.includes('projmnt4claude/hooks/')) {
                shouldRemove = true;
              }
            } else if (Array.isArray(hookConfig)) {
              const filtered = hookConfig.filter(item => {
                if (typeof item === 'string') {
                  return !item.includes('projmnt4claude/hooks/');
                } else if (typeof item === 'object' && item !== null) {
                  const hookItem = item as { command?: string; script?: string; run?: string };
                  const hookValue = hookItem.command || hookItem.script || hookItem.run || '';
                  return !hookValue.includes('projmnt4claude/hooks/');
                }
                return true;
              });
              if (filtered.length !== hookConfig.length) {
                if (filtered.length === 0) {
                  shouldRemove = true;
                } else {
                  hooks[hookType] = filtered;
                  modified = true;
                }
              }
            } else if (typeof hookConfig === 'object' && hookConfig !== null) {
              const hookObj = hookConfig as { command?: string; script?: string; run?: string };
              const hookValue = hookObj.command || hookObj.script || hookObj.run || '';
              if (hookValue.includes('projmnt4claude/hooks/')) {
                shouldRemove = true;
              }
            }

            if (shouldRemove) {
              delete hooks[hookType];
              modified = true;
            }
          }

          if (modified) {
            fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
            removedSettings = true;
          }
        } catch {
          // Ignore parse errors
        }
      }

      // 2. Clean deprecated scripts from .projmnt4claude/hooks/ directory
      const hooksDir = path.join(cwd, '.projmnt4claude', 'hooks');
      if (fs.existsSync(hooksDir)) {
        try {
          const files = fs.readdirSync(hooksDir);
          for (const file of files) {
            if (DEPRECATED_HOOK_SCRIPTS.includes(file)) {
              const filePath = path.join(hooksDir, file);
              fs.unlinkSync(filePath);
              removedFiles = true;
            }
          }

          // Delete directory if empty
          const remainingFiles = fs.readdirSync(hooksDir);
          if (remainingFiles.length === 0) {
            fs.rmdirSync(hooksDir);
          }
        } catch {
          // Ignore file operation errors
        }
      }

      if (removedSettings || removedFiles) {
        console.log(texts.cleanedDeprecatedHookConfig);
        if (removedSettings) {
          console.log(texts.updatedSettings);
        }
        if (removedFiles) {
          console.log(texts.deletedDeprecatedScripts);
        }
      }
    }
  }

  console.log('');
  console.log('✅ ' + texts.fixComplete);
}

/**
 * Generate Bug Report
 * Calls Logger to generate Markdown report + .tar.gz log archive attachment
 */
export async function runBugReport(cwd: string = process.cwd()): Promise<void> {
  const texts = t(cwd).doctorCmd;
  console.log('');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('📋 ' + texts.bugReportGeneration);
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('');

  if (!isInitialized(cwd)) {
    console.error('❌ ' + texts.errorProjectNotInitialized);
    console.error(texts.runSetupFirst);
    process.exit(1);
  }

  const logger = new Logger({ cwd });

  try {
    // Generate bug report
    const report = logger.generateBugReport(100);

    // Output report
    console.log(report.markdown);
    console.log('');
    console.log('━'.repeat(SEPARATOR_WIDTH));

    // Output cost summary
    console.log('');
    console.log('━'.repeat(SEPARATOR_WIDTH));
    console.log('💰 ' + texts.aiCostSummary);
    console.log('━'.repeat(SEPARATOR_WIDTH));
    console.log('');

    const costSummary = logger.getCostSummary();
    console.log(texts.totalAiCalls.replace('{count}', String(costSummary.totalCalls)));
    console.log(texts.totalDuration.replace('{duration}', (costSummary.totalDurationMs / 1000).toFixed(1)));
    console.log(texts.totalTokens
      .replace('{total}', String(costSummary.totalTokens))
      .replace('{input}', String(costSummary.totalInputTokens))
      .replace('{output}', String(costSummary.totalOutputTokens)));

    if (Object.keys(costSummary.byField).length > 0) {
      console.log('');
      console.log(texts.byField);
      for (const [field, info] of Object.entries(costSummary.byField)) {
        console.log(texts.fieldStats
          .replace('{field}', field)
          .replace('{calls}', String(info.calls))
          .replace('{duration}', (info.durationMs / 1000).toFixed(1))
          .replace('{tokens}', String(info.totalTokens)));
      }
    }

    // Output usage analysis
    console.log('');
    console.log('━'.repeat(SEPARATOR_WIDTH));
    console.log('📊 ' + texts.usageAnalysis);
    console.log('━'.repeat(SEPARATOR_WIDTH));
    console.log('');

    const usage = logger.analyzeUsage();
    console.log(texts.totalCommandExecutions.replace('{count}', String(usage.totalCommands)));
    console.log(texts.averageDuration.replace('{duration}', (usage.averageDurationMs / 1000).toFixed(1)));
    console.log(texts.aiUsageRate.replace('{rate}', (usage.aiUsageRate * 100).toFixed(1)));
    console.log(texts.errorsAndWarnings
      .replace('{errors}', String(usage.totalErrors))
      .replace('{warnings}', String(usage.totalWarnings)));

    if (Object.keys(usage.commandFrequency).length > 0) {
      console.log('');
      console.log(texts.commandFrequency);
      const sorted = Object.entries(usage.commandFrequency).sort((a, b) => b[1] - a[1]);
      for (const [cmd, count] of sorted) {
        console.log(texts.commandCount.replace('{cmd}', cmd).replace('{count}', String(count)));
      }
    }

    if (usage.commonErrors.length > 0) {
      console.log('');
      console.log(texts.commonErrors);
      for (const err of usage.commonErrors.slice(0, 5)) {
        console.log(texts.errorEntry.replace('{count}', String(err.count)).replace('{message}', err.message));
      }
    }

    console.log('');
    console.log('━'.repeat(SEPARATOR_WIDTH));
    console.log('✅ ' + texts.bugReportGenerated);
    console.log('📎 ' + texts.logArchive.replace('{path}', report.archivePath));
  } catch (err) {
    console.error('');
    console.error('❌ ' + texts.bugReportFailed.replace('{error}', err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }
}

/**
 * Run deep diagnostics (--deep mode)
 *
 * On top of rule-based quick analysis, runs all log analyzers (rule + AI hybrid strategy),
 * providing deeper problem detection and fix recommendations.
 */
export async function runDoctorDeep(cwd: string = process.cwd()): Promise<void> {
  const texts = t(cwd).doctorCmd;
  console.log('');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('🔬 ' + texts.deepLogAnalysis);
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('');

  // 1. Run regular doctor check first
  await runDoctor(false, cwd);

  console.log('');
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('📊 ' + texts.deepLogAnalysis.replace(' (--deep)', ''));
  console.log('━'.repeat(SEPARATOR_WIDTH));
  console.log('');

  // 2. Collect logs
  const collector = new LogCollector(cwd);
  const stats = collector.getStats();

  if (stats.fileCount === 0) {
    console.log('ℹ️  ' + texts.noLogFilesFound);
    console.log(texts.logDirectory.replace('{path}', getLogsDir(cwd)));
    return;
  }

  console.log('📂 ' + texts.logFilesCount.replace('{count}', String(stats.fileCount)).replace('{size}', String(stats.totalSizeKB)));

  // Collect logs from last 24 hours
  const entries = collector.collectSince(24, { maxEntries: 10000 });
  console.log('📋 ' + texts.logEntriesCount.replace('{count}', String(entries.length)));
  console.log('');

  if (entries.length === 0) {
    console.log('ℹ️  ' + texts.noLogEntriesInLast24Hours);
    return;
  }

  // 3. Register and run all analyzers
  const registry = new LogAnalyzerRegistry(cwd);
  for (const analyzer of getBuiltInAnalyzers()) {
    registry.register(analyzer);
  }

  console.log('🔧 ' + texts.registeredAnalyzers.replace('{count}', String(registry.size)));
  for (const analyzer of registry.getAll()) {
    console.log('   ' + texts.analyzerEntry
      .replace('{name}', analyzer.name)
      .replace('{category}', analyzer.category)
      .replace('{strategies}', analyzer.supportedStrategies.join(', ')));
  }
  console.log('');

  // Use hybrid strategy (rules + AI)
  const results = await registry.runAll(entries, 'hybrid', { cwd, enableAI: true });

  // 4. Generate report
  const reporter = new AnalysisReporter();
  const report = reporter.buildReport(results, stats.fileCount, entries.length);

  console.log(reporter.formatText(report));

  // 5. Output recommendations
  if (report.summary.totalFindings > 0) {
    console.log('━'.repeat(SEPARATOR_WIDTH));
    console.log('📊 ' + texts.foundIssues.replace('{count}', String(report.summary.totalFindings)));

    const critical = report.summary.bySeverity['critical'] || 0;
    const errors = report.summary.bySeverity['error'] || 0;
    if (critical > 0) {
      console.log('🔴 ' + texts.criticalIssuesRequireAttention.replace('{count}', String(critical)));
    }
    if (errors > 0) {
      console.log('❌ ' + texts.errorsNeedAttention.replace('{count}', String(errors)));
    }
  } else {
    console.log('✅ ' + texts.deepAnalysisComplete);
  }
}
