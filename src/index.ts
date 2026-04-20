#!/usr/bin/env bun
import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { setup } from './commands/setup';
import { listConfig, getConfig, setConfig } from './commands/config';
import {
  createTask,
  listTasks,
  showTask,
  updateTask,
  deleteTask,
  addDependency,
  removeDependency,
  executeTask,
  completeCheckpoint,
  verifyCheckpoint,
  addSubtask,
  showStatusGuide,
  completeTask,
  showTaskHistory,
  syncChildren,
  updateCheckpoint,
  listTaskCheckpoints,
  splitTask,
  searchTasks,
  batchUpdateTasks,
  submitTask,
  validateTask,
  countTasks,
  purgeTasks,
  renameTaskCommand,
  showBatchUpdateLogs,
} from './commands/task';
import {
  showPlan,
  addTask,
  removeTask,
  clearPlanCmd,
  recommendPlan,
} from './commands/plan';
import {
  analyzeProject,
  showAnalysis,
  fixIssues,
  showStatus,
  fixCheckpoints,
  performQualityCheck,
  showQualityReport,
  analyzeBugReport,
} from './commands/analyze';
import { fixPipeline } from './commands/analyze-fix-pipeline';
import { initRequirement } from './commands/init-requirement';
import { showHelp } from './commands/help';
import { runDoctor, runBugReport, runDoctorDeep } from './commands/doctor';
import { harnessCommand, cleanupHarnessSnapshots } from './commands/harness';
import { isInitialized } from './utils/path';

/**
 * 检查项目是否已初始化，未初始化则报错退出
 */
function requireInit(): void {
  if (!isInitialized()) {
    console.error('(X) Error: Project not initialized');
    console.error('');
    console.error('Please run the following command to initialize:');
    console.error('  projmnt4claude setup');
    console.error('');
    console.error('Or use slash command:');
    console.error('  /projmnt4claude:setup');
    process.exit(1);
  }
}

/**
 * 收集多次指定的选项值
 * 用于支持 --tasks TASK-001 --tasks TASK-002 格式
 */
function collectValues(value: string, previous: string[]): string[] {
  return previous.concat(value);
}

const program = new Command();

program
  .name('projmnt4claude')
  .description('Claude Code Project Management CLI Tool')
  .version('0.1.0')
  .option('--ai', 'AI 模式: 自动启用 --json 输出 + 非交互模式 + 精简日志')
  .option('--json', 'JSON 格式输出 (全局)')
  .hook('preAction', (thisCommand) => {
    // AI 模式自动启用 JSON 输出
    const opts = thisCommand.opts();
    if (opts.ai) {
      process.env.PROJMNT4CLAUDE_AI_MODE = 'true';
      process.env.PROJMNT4CLAUDE_JSON_OUTPUT = 'true';
    }
    if (opts.json || opts.ai) {
      process.env.PROJMNT4CLAUDE_JSON_OUTPUT = 'true';
    }
  });

// setup command
program
  .command('setup')
  .description('Initialize project management environment in current project, with language selection (Chinese/English)')
  .option('-y, --yes', 'Non-interactive mode: skip all confirmations, use default settings')
  .option('-l, --language <language>', 'Specify language (zh/en)')
  .option('-f, --force', 'Force re-initialization (re-copy skill files)')
  .action(async (options) => {
    await setup(process.cwd(), { nonInteractive: options.yes, language: options.language, force: options.force });
  });

// config command group
program
  .command('config <action> [key] [value]')
  .description('Manage configuration (list/get/set)')
  .action((action, key, value) => {
    requireInit();
    switch (action) {
      case 'list':
        listConfig();
        break;
      case 'get':
        if (!key) {
          console.error('(X) Error: get operation requires key');
          process.exit(1);
        }
        getConfig(key);
        break;
      case 'set':
        if (!key || value === undefined) {
          console.error('(X) Error: set operation requires key and value');
          process.exit(1);
        }
        setConfig(key, value);
        break;
      default:
        console.error('(X) Error: Unknown action \'' + action + '\'. Supported: list, get, set');
        process.exit(1);
    }
  });

// task command group
program
  .command('task <action> [id]')
  .description('Manage tasks\n\nBasic: create/list/show/get/update/delete/rename/purge/execute/checkpoint\nAdvanced: dependency/add-subtask/status-guide/complete/split/search/batch-update/batch-update-logs/count\n\n[Deprecated - will be removed]:\n  submit                 Use: task update <id> --status wait_evaluation\n  validate               Use: harness evaluation phase (auto-executed)\n\nGlobal Options:\n  --token <n>            Token estimation\n  -f, --force            Force operation\n\ncreate Options:\n  --into <id>            Create as subtask\n  --from-requirement     Create from requirement\n  --requirement-text <text>  Requirement text\n\nlist Options:\n  --status <status>      Filter by status\n  --priority <priority>  Filter by priority\n  --type <type>          Filter by type\n\nshow Options:\n  --json                 JSON output\n\nupdate Options:\n  --status <status>      Update status\n  --priority <priority>  Update priority\n  --sync-children        Sync subtask status\n\ndependency Options:\n  --from <id>            Dependency source\n  --to <id>              Dependency target\n  --remove               Remove dependency\n\nsplit Options:\n  --parts <n>            Split count\n  --strategy <strategy>  Split strategy\n\ncheckpoint Options:\n  --pass                 Pass checkpoint\n  --fail                 Fail checkpoint\n  --missing-verification Mark needs verification\n\n! dependency format (note argument order):\n  task dependency <add|remove> <taskId> --dep-id <depTaskId>\n\n  Examples:\n    task dependency add TASK-001 --dep-id TASK-002    # TASK-001 depends on TASK-002\n    task dependency remove TASK-001 --dep-id TASK-002 # Remove dependency\n\nrename format:\n  task rename <oldTaskId> <newTaskId>\n\n  Example:\n    task rename TASK-001 TASK-feature-new-name')
  .allowExcessArguments(true)
  .option('-s, --status <status>', 'Filter by status (list only)')
  .option('-p, --priority <priority>', 'Filter by priority (list only)')
  .option('-r, --role <role>', 'Filter by recommended role (list only)')
  .option('--dep-id <depId>', 'Dependency task ID (dependency only)')
  .option('--title <title>', 'Task title (create/update only)')
  .option('--description <description>', 'Task description (create/update only)')
  .option('--type <type>', 'Task type (create/count): bug/feature/research/docs/refactor/test')
  .option('-y, --yes', 'Non-interactive mode (create/checkpoint/delete only)')
  .option('--token <n>', 'Token estimation')
  .option('--sync-children', 'Sync subtask status (update resolved/closed only)')
  .option('--no-sync', 'Do not sync subtask status (update only)')
  .option('--topic <topic>', 'Discussion topic (discuss only)')
  // New options (bug_report_4.md)
  .option('-v, --verbose', '显示完整信息 (仅 show)')
  .option('--history', 'Show change history only (show only)')
  .option('--json', 'JSON format output (show/get/list/status/count only)')
  .option('--compact', 'Compact output (show only)')
  .option('--fields <fields>', 'Custom output fields (list only)')
  .option('--missing-verification', 'Filter tasks missing verification (list only)')
  .option('-g, --group <field>', 'Group display (list only): status/priority/type/role')
  .option('--checkpoints', 'Show checkpoint details (show only)')
  .option('--format <format>', 'Output format (show only): panel/classic')
  .option('--result <result>', 'Verification result (checkpoint complete only)')
  .option('--note <note>', 'Checkpoint note (checkpoint note/fail only)')
  .option('--into <count>', 'Split count (split only)')
  .option('--titles <titles>', 'Subtask title list (split only)')
  .option('--skip-validation', 'Skip checkpoint quality validation (create only)')
  .option('-f, --force', 'Force operation')
  .option('--file <path>', 'Read description from file (create only, for long descriptions with special characters)')
  .option('--from-requirement', 'Create from requirement (create only)')
  .option('--requirement-text <text>', 'Requirement text (create only)')
  .option('--branch <branch>', 'Associated branch (create only)')
  .option('--from <id>', 'Dependency source (dependency only)')
  .option('--to <id>', 'Dependency target (dependency only)')
  .option('--remove', 'Remove dependency (dependency only)')
  .option('--parts <n>', 'Split count (split only)')
  .option('--strategy <strategy>', 'Split strategy (split only)')
  .option('--pass', 'Pass checkpoint (checkpoint only)')
  .option('--fail', 'Fail checkpoint (checkpoint only)')
  .option('--all', 'Include all tasks including resolved/closed (batch-update only)')
  .option('--tasks <ids>', 'Specify task ID list, comma-separated (batch-update only)', collectValues, [])
  .option('--task-file <path>', 'Read task ID list from file, one per line or comma-separated (batch-update only)')
  .option('--change-note <note>', 'Change note, at least 10 characters, recorded in transitionNotes (batch-update only)')
  .option('--source <source>', 'Filter log source (batch-update-logs only): cli/ide/hook/script/unknown')
  .option('--summary', 'Show log statistics summary (batch-update-logs only)')
  // Reopen options (P2-feature)
  .option('--enhancement', 'Mark reopen as enhancement request (reopen only)')
  .option('--failed-checkpoints <ids>', 'Failed checkpoint IDs, comma-separated (reopen only)')
  .option('--qa-feedback <text>', 'QA feedback for reopen (reopen only)')
  .action(async (action, id, options) => {
    requireInit();
    switch (action) {
      case 'create': {
        let taskDescription = options.description;
        if (options.file) {
          const filePath = path.resolve(options.file);
          if (!fs.existsSync(filePath)) {
            console.error('(X) Error: Description file not found: ' + filePath);
            process.exit(1);
          }
          const stat = fs.statSync(filePath);
          if (!stat.isFile()) {
            console.error('(X) Error: Path is not a file: ' + filePath);
            process.exit(1);
          }
          const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
          if (stat.size > MAX_FILE_SIZE) {
            console.error('(X) Error: File too large (' + (stat.size / 1024 / 1024).toFixed(2) + 'MB), max 10MB');
            process.exit(1);
          }
          try {
            taskDescription = fs.readFileSync(filePath, 'utf-8');
          } catch (error: any) {
            console.error('(X) Error: Cannot read description file: ' + error.message);
            process.exit(1);
          }
          if (filePath.startsWith('/tmp/')) {
            try { fs.unlinkSync(filePath); } catch { /* ignore */ }
          }
        }
        await createTask({
          title: options.title,
          description: taskDescription,
          priority: options.priority,
          type: options.type,
          nonInteractive: options.yes,
          skipValidation: options.skipValidation,
          id: id,  // Pass user-specified task ID
          branch: options.branch,
        });
        break;
      }
      case 'list':
        listTasks({
          status: options.status,
          priority: options.priority,
          role: options.role,
          fields: options.fields,
          format: (options.json || program.opts().json) ? 'json' : undefined,
          missingVerification: options.missingVerification,
          group: options.group,
        });
        break;
      case 'get':
      case 'show':
        if (!id) {
          console.error('(X) Error: ' + action + ' requires task ID');
          process.exit(1);
        }
        showTask(id, {
          verbose: options.verbose,
          history: options.history,
          json: options.json || program.opts().json || false,
          compact: options.compact,
          checkpoints: options.checkpoints,
          format: options.format,
        });
        break;
      case 'update':
        if (!id) {
          console.error('(X) Error: update operation requires task ID');
          process.exit(1);
        }
        await updateTask(id, {
          title: options.title,
          description: options.description,
          status: options.status,
          priority: options.priority,
          role: options.role,
          token: options.token,
          syncChildren: options.syncChildren,
          noSync: options.noSync,
          enhancement: options.enhancement,
          failedCheckpoints: options.failedCheckpoints,
          qaFeedback: options.qaFeedback,
        });
        break;
      case 'delete':
        if (!id) {
          console.error('(X) Error: delete operation requires task ID');
          process.exit(1);
        }
        await deleteTask(id, options.yes);
        break;
      case 'purge':
        purgeTasks({
          force: options.yes,
          json: options.json || program.opts().json || false,
        });
        break;
      case 'execute':
        if (!id) {
          console.error('(X) Error: execute operation requires task ID');
          process.exit(1);
        }
        await executeTask(id);
        break;
      case 'status-guide':
        showStatusGuide();
        break;
      case 'history':
        if (!id) {
          console.error('(X) Error: history operation requires task ID');
          process.exit(1);
        }
        showTaskHistory(id);
        break;
      case 'complete':
        if (!id) {
          console.error('(X) Error: complete operation requires task ID');
          process.exit(1);
        }
        await completeTask(id, { yes: options.yes });
        break;
      case 'checkpoint':
        if (!id) {
          console.error('(X) Error: checkpoint operation requires task ID');
          process.exit(1);
        }
        // New: Support multiple checkpoint subcommands
        // Usage:
        //   task checkpoint <taskId> list
        //   task checkpoint <taskId> <checkpointId> complete --result "xxx"
        //   task checkpoint <taskId> <checkpointId> fail --note "xxx"
        //   task checkpoint <taskId> <checkpointId> note --note "xxx"
        //   task checkpoint <taskId> <checkpointId> show
        //   task checkpoint <taskId> verify (original function)

        // Find checkpoint position in process.argv
        const checkpointIndex = process.argv.indexOf('checkpoint');
        // After checkpoint is taskId, then subcommand
        const afterTaskId = checkpointIndex + 2 < process.argv.length ? process.argv[checkpointIndex + 2] : undefined;
        const afterSubCommand = checkpointIndex + 3 < process.argv.length ? process.argv[checkpointIndex + 3] : undefined;

        // id is taskId (parsed from commander)
        const checkpointSubCmd = afterTaskId;
        const checkpointAct = afterSubCommand;

        if (checkpointSubCmd === 'list') {
          // List all checkpoints
          await listTaskCheckpoints(id, { json: options.json, compact: options.compact });
        } else if (checkpointSubCmd === 'verify') {
          // Original function: verify checkpoint
          await verifyCheckpoint(id);
        } else if (checkpointSubCmd && checkpointAct) {
          // Checkpoint operation: task checkpoint <taskId> <checkpointId> <action>
          const validActions = ['complete', 'fail', 'note', 'show'];
          if (!validActions.includes(checkpointAct)) {
            console.error("(X) Error: Invalid action '" + checkpointAct + "'");
            console.error("Supported: " + validActions.join(', '));
            process.exit(1);
          }
          await updateCheckpoint(id, checkpointSubCmd, checkpointAct as any, {
            result: options.result,
            note: options.note,
            yes: options.yes,
          });
        } else {
          // Default behavior: complete checkpoint confirmation (backward compatible)
          await completeCheckpoint(id, { yes: options.yes });
        }
        break;
      case 'discuss':
        if (!id) {
          console.error('(X) Error: discuss operation requires task ID');
          process.exit(1);
        }
        // discuss function integrated into update command --needs-discussion option
        console.log('Hint: Use task update --needs-discussion to mark task for discussion');
        console.log('      Use task update --topic "topic content" to add discussion topic');
        break;
      case 'dependency': {
        // Usage: task dependency add <taskId> --dep-id <depId>
        //       task dependency remove <taskId> --dep-id <depId>

        // Helper function to show help info
        const showDependencyHelp = () => {
          console.error('');
          console.error('dependency subcommand usage:');
          console.error('  task dependency add <taskId> --dep-id <depTaskId>');
          console.error('  task dependency remove <taskId> --dep-id <depTaskId>');
          console.error('');
          console.error('Examples:');
          console.error('  task dependency add TASK-001 --dep-id TASK-002');
          console.error('  task dependency remove TASK-001 --dep-id TASK-002');
          console.error('');
          console.error('Description:');
          console.error('  - add: Add dependency, taskId depends on depTaskId');
          console.error('  - remove: Remove dependency');
          console.error('  - taskId: Task ID to add/remove dependency');
          console.error('  - --dep-id: Dependency task ID');
        };

        if (!id) {
          console.error('(X) Error: dependency requires sub-action (add/remove)');
          showDependencyHelp();
          process.exit(1);
        }

        // id should be 'add' or 'remove'
        if (id !== 'add' && id !== 'remove') {
          // Detect common error: user may put taskId in add/remove position
          if (id.startsWith('TASK-') || id.startsWith('task-')) {
            console.error("(X) Error: Wrong argument order");
            console.error('');
            console.error('You entered: task dependency ' + id + ' ...');
            console.error('Correct format: task dependency <add|remove> ' + id + ' --dep-id <depTaskId>');
            console.error('');
            console.error('Hint: Sub-action (add/remove) must follow dependency');
          } else {
            console.error("(X) Error: Unknown sub-action '" + id + "', supported: add, remove");
          }
          showDependencyHelp();
          process.exit(1);
        }

        // Get taskId from process.argv (after add/remove)
        const depIndex = process.argv.indexOf('dependency');
        const taskId = process.argv[depIndex + 2]; // Skip 'dependency' and 'add/remove'

        if (!taskId || taskId.startsWith('-')) {
          console.error('(X) Error: Task ID required');
          showDependencyHelp();
          process.exit(1);
        }

        if (!options.depId) {
          console.error('(X) Error: --dep-id required (dependency task ID)');
          console.error('');
          console.error('Example: task dependency ' + id + ' ' + taskId + ' --dep-id TASK-xxx');
          process.exit(1);
        }

        if (id === 'add') {
          addDependency(taskId, options.depId);
        } else {
          removeDependency(taskId, options.depId);
        }
        break;
      }
      case 'add-subtask': {
        if (!id) {
          console.error('(X) Error: add-subtask operation requires parent task ID');
          process.exit(1);
        }
        // title should be arguments after process.argv[5]
        const title = process.argv.slice(5).join(' ');
        await addSubtask(id, title);
        break;
      }
      case 'submit': {
        if (!id) {
          console.error('(X) Error: submit operation requires task ID');
          process.exit(1);
        }
        console.warn('[Notice]: task submit command is deprecated');
        console.warn('   Use: projmnt4claude task update <taskId> --status wait_evaluation');
        console.warn('');
        await submitTask(id, {
          note: options.note,
        });
        break;
      }
      case 'validate': {
        if (!id) {
          console.error('(X) Error: validate operation requires task ID');
          process.exit(1);
        }
        await validateTask(id, {
          executeCommands: options.executeCommands,
          autoResolve: options.autoResolve,
        });
        break;
      }
      case 'sync-children': {
        if (!id) {
          console.error('(X) Error: sync-children operation requires parent task ID');
          process.exit(1);
        }
        await syncChildren(id, {
          targetStatus: options.status,
        });
        break;
      }
      case 'split': {
        if (!id) {
          console.error('(X) Error: split operation requires parent task ID');
          process.exit(1);
        }
        await splitTask(id, {
          into: options.into ? parseInt(options.into) : undefined,
          titles: options.titles,
          nonInteractive: options.yes,
        });
        break;
      }
      case 'search': {
        if (!id) {
          console.error('(X) Error: search operation requires search keyword');
          process.exit(1);
        }
        searchTasks(id, {
          status: options.status,
          priority: options.priority,
          json: options.json,
        });
        break;
      }
      case 'batch-update': {
        await batchUpdateTasks({
          status: options.status,
          priority: options.priority,
          all: options.all,
          yes: options.yes,
          tasks: options.tasks,
          taskFile: options.taskFile,
          changeNote: options.changeNote,
        });
        break;
      }
      case 'batch-update-logs': {
        showBatchUpdateLogs({
          taskId: options.taskId,
          source: options.source,
          verbose: options.verbose,
          summary: options.summary,
        });
        break;
      }
      case 'count': {
        // Debug: log options
        if (process.env.DEBUG_COUNT) {
          console.error('DEBUG count options:', JSON.stringify(options));
          console.error('DEBUG options.json:', options.json);
          console.error('DEBUG optsWithGlobals.json:', program.opts().json);
        }
        countTasks({
          status: options.status,
          priority: options.priority,
          type: options.type,
          groupBy: options.group as 'status' | 'priority' | 'type' | 'role' | undefined,
          json: options.json || program.opts().json || false,
        });
        break;
      }
      case 'rename': {
        // 用法: task rename <oldTaskId> <newTaskId>
        const renameIndex = process.argv.indexOf('rename');
        const oldTaskId = renameIndex + 1 < process.argv.length ? process.argv[renameIndex + 1] : undefined;
        const newTaskId = renameIndex + 2 < process.argv.length ? process.argv[renameIndex + 2] : undefined;

        if (!oldTaskId || !newTaskId) {
          console.error('(X) Error: rename operation requires old task ID and new task ID');
          console.error('');
          console.error('Usage: task rename <oldTaskId> <newTaskId>');
          console.error('Example: task rename TASK-001 TASK-feature-new-name');
          process.exit(1);
        }

        renameTaskCommand(oldTaskId, newTaskId);
        break;
      }
      default:
        console.error("(X) Error: Unknown action '" + action + "'. Supported: create, list, show, update, delete, rename, purge, execute, checkpoint, dependency, discuss, add-subtask, sync-children, split, search, batch-update, batch-update-logs, submit, validate, history, status-guide, complete, count");
        process.exit(1);
    }
  });

// plan command group
program
  .command('plan <action> [id]')
  .description('管理执行计划 (show/add/remove/clear/recommend)\n\nrecommend 子命令支持三层依赖推断:\n  Layer1/2: 文件路径重叠 (默认)\n  Layer3: AI 语义推断 (--smart 激活)')
  .option('-j, --json', '以 JSON 格式输出 (仅 show/recommend)')
  .option('-f, --force', '强制执行，跳过确认 (仅 clear)')
  .option('-a, --after <taskId>', '在指定任务之后添加 (仅 add)')
  .option('-y, --yes', '非交互模式，自动应用推荐 (仅 recommend)')
  .option('-q, --query <query>', '用户描述/关键字过滤 (仅 recommend)')
  .option('--smart', '启用 AI 语义依赖推断 (仅 recommend, Layer3 增强)')
  .option('--all', '显示全部状态任务，默认仅推荐 open (仅 recommend)')
  .option('--strict-subtask-coverage', '严格子任务覆盖检测：发现缺失子任务时中止推荐 (仅 recommend)')
  .option('--strict-quality-gate', '严格质量门禁检查：质量检查失败时中止推荐 (仅 recommend)')
  .option('--quality-threshold <score>', '质量门禁阈值 (0-100)，低于此分数的任务将被标记 (仅 recommend)', '60')
  .option('--skip-quality-gate', '跳过质量门禁检查 (仅 recommend)')
  .action(async (action, id, options) => {
    requireInit();
    switch (action) {
      case 'show':
        showPlan(options.json);
        break;
      case 'add':
        if (!id) {
          console.error('(X) Error: add operation requires task ID');
          process.exit(1);
        }
        addTask(id, options.after);
        break;
      case 'remove':
        if (!id) {
          console.error('(X) Error: remove operation requires task ID');
          process.exit(1);
        }
        removeTask(id);
        break;
      case 'clear':
        await clearPlanCmd(options.force);
        break;
      case 'recommend':
        await recommendPlan({
          query: options.query,
          nonInteractive: options.yes,
          json: options.json,
          all: options.all,
          smart: options.smart,
          strictSubtaskCoverage: options.strictSubtaskCoverage,
          strictQualityGate: options.strictQualityGate,
          qualityThreshold: parseInt(options.qualityThreshold, 10) || 60,
          skipQualityGate: options.skipQualityGate,
        });
        break;
      default:
        console.error("(X) Error: Unknown action '" + action + "'. Supported: show, add, remove, clear, recommend");
        process.exit(1);
    }
  });

// status command
program
  .command('status')
  .description('Show project status summary')
  .option('--archived', 'Show archived task statistics')
  .option('-a, --all', 'Show all tasks (including archived)')
  .option('-q, --quiet', 'Quiet output: only show key metrics')
  .option('--json', 'JSON format output')
  .option('--compact', 'Use compact separators')
  .action(async (options) => {
    requireInit();
    await showStatus({
      includeArchived: options.archived || options.all,
      quiet: options.quiet,
      json: options.json,
      compact: options.compact,
    });
  });

// analyze command
program
  .command('analyze')
  .description('Analyze project health status')
  .option('--fix', 'Auto-fix all fixable issues')
  .option('--fix-checkpoints', 'Intelligently generate missing checkpoints')
  .option('--quality-check', 'Check task content quality (description completeness, checkpoint quality, related files, solution)')
  .option('--threshold <score>', 'Quality check threshold, tasks below this score will be flagged (default: 60)', '60')
  .option('-j, --json', 'JSON format output (quality-check only)')
  .option('-y, --yes', 'Non-interactive mode: auto-fix fixable issues')
  .option('--compact', 'Use compact separators')
  .option('--task <taskId>', 'Specify task ID (fix-checkpoints only)')
  .option('--check-range <range>', 'Analysis range: all(default), tasks:ID1,ID2, keyword:pattern')
  .option('--deep-analyze', 'Deep analysis: enable AI semantic duplicate detection, stale evaluation, semantic quality scoring')
  .option('--no-ai', 'Disable all AI features, use rule engine analysis only')
  .option('--rules-only', 'Execute rule analysis+fix only (Stage 1,2), requires --fix')
  .option('--checkpoints-only', 'Execute checkpoint fix only (Stage 4), requires --fix')
  .option('--quality-only', 'Execute quality report only (Stage 5), requires --fix')
  .option('--bug-report <path>', 'Bug Report analysis mode: analyze specified bug report file or directory')
  .option('--export-training-data', 'Export training data as JSONL format (requires --bug-report, requires config training.exportEnabled)')
  .action(async (options) => {
    requireInit();
    const aiOptions = {
      deepAnalyze: !!options.deepAnalyze,
      noAi: !!options.noAi,
    };
    if (options.bugReport) {
      await analyzeBugReport(options.bugReport, process.cwd(), {
        exportTrainingData: !!options.exportTrainingData,
        noAi: !!options.noAi,
      });
    } else if (options.fix) {
      // --fix pipeline mode: supports --no-ai, --rules-only, --checkpoints-only, --quality-only
      await fixPipeline(process.cwd(), {
        nonInteractive: options.yes,
        rulesOnly: !!options.rulesOnly,
        checkpointsOnly: !!options.checkpointsOnly,
        qualityOnly: !!options.qualityOnly,
        noAi: !!options.noAi,
        aiOptions,
        compact: options.compact,
        json: options.json || program.opts().json || false,
        threshold: parseInt(options.threshold) || 60,
        taskId: options.task,
      });
    } else if (options.fixCheckpoints) {
      await fixCheckpoints(process.cwd(), { nonInteractive: options.yes, taskId: options.task });
    } else if (options.qualityCheck) {
      const scores = await performQualityCheck(process.cwd(), aiOptions);
      showQualityReport(scores, {
        compact: options.compact,
        json: options.json || program.opts().json || false,
        threshold: parseInt(options.threshold) || 60,
      });
    } else {
      await showAnalysis({ compact: options.compact, ...aiOptions, checkRange: options.checkRange });
    }
  });

// init-requirement command
program
  .command('init-requirement [description]')
  .description('从自然语言需求描述创建任务，自动解析需求并生成任务结构\n\n' +
    '自动分析: 优先级(P0-P3)、推荐角色、复杂度、检查点、依赖\n\n' +
    '示例:\n' +
    '  init-requirement "实现用户登录API接口，需要高优先级处理"\n' +
    '  init-requirement -y "紧急修复线上支付接口超时问题"\n' +
    '  init-requirement -y --no-plan "为认证模块编写单元测试"\n' +
    '  init-requirement -y --file ./description.md\n\n' +
    '选项:\n' +
    '  -y, --yes                非交互模式：跳过所有确认，直接使用分析结果创建任务\n' +
    '  --no-plan                创建任务后不询问是否添加到执行计划\n' +
    '  --skip-validation        跳过初始化验证\n' +
    '  --template <file>        使用需求模板文件\n' +
    '  --auto-split             自动拆分为子任务\n' +
    '  --no-ai                  禁用 AI 辅助\n' +
    '  --require-quality <n>    质量门禁阈值\n' +
    '  -f, --force              强制覆盖\n' +
    '  --accept-draft           接受草稿\n' +
    '  --accept-audit           接受审计\n' +
    '  --accept-eval            接受评估\n\n' +
    '前提: 需先运行 projmnt4claude setup 初始化项目')
  .option('-y, --yes', '非交互模式：跳过所有确认，直接使用分析结果创建任务')
  .option('--no-plan', '创建任务后不询问是否添加到执行计划')
  .option('--skip-validation', '跳过初始化验证')
  .option('--template <file>', '使用需求模板文件', 'simple')
  .option('--auto-split', '自动拆分为子任务')
  .option('--no-ai', '禁用 AI 辅助')
  .option('--require-quality <n>', '质量门禁阈值')
  .option('-f, --force', '强制覆盖')
  .option('--file <path>', '从文件读取描述（用于包含特殊字符的长描述）')
  .option('--decompose', '自动分解多问题需求/报告（默认启用）', true)
  .option('--no-decompose', '禁用需求分解，强制创建单个任务')
  .option('--accept-draft', '接受草稿')
  .option('--accept-audit', '接受审计')
  .option('--accept-eval', '接受评估')
  .action(async (description, options) => {
    let finalDescription: string | undefined;

    // Priority: --file > command line arguments
    if (options.file) {
      const filePath = path.resolve(options.file);

      // Validate file exists
      if (!fs.existsSync(filePath)) {
        console.error('(X) Error: Description file not found: ' + filePath);
        process.exit(1);
      }

      // Validate is file
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) {
        console.error('(X) Error: Path is not a file: ' + filePath);
        process.exit(1);
      }

      // Validate file size (limit 10MB to prevent memory issues)
      const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
      if (stat.size > MAX_FILE_SIZE) {
        console.error('(X) Error: File too large (' + (stat.size / 1024 / 1024).toFixed(2) + 'MB), max 10MB');
        process.exit(1);
      }

      try {
        finalDescription = fs.readFileSync(filePath, 'utf-8');
      } catch (error: any) {
        console.error('(X) Error: Cannot read description file: ' + error.message);
        process.exit(1);
      }

      // Clean up temp file (if in /tmp)
      if (filePath.startsWith('/tmp/')) {
        try {
          fs.unlinkSync(filePath);
        } catch {
          // Ignore delete failure
        }
      }
    } else if (description) {
      finalDescription = description;
    }

    // Validate description must exist
    if (!finalDescription || finalDescription.trim().length === 0) {
      console.error('(X) Error: Description or --file option required');
      console.error('');
      console.error('Usage:');
      console.error('  projmnt4claude init-requirement "description"');
      console.error('  projmnt4claude init-requirement --file ./description.md');
      console.error('');
      console.error('Hint: Use --file when description contains code blocks or special characters');
      process.exit(1);
    }

    requireInit();
    await initRequirement(finalDescription, process.cwd(), {
      nonInteractive: options.yes,
      noPlan: options.noPlan,
      skipValidation: options.skipValidation,
      template: options.template,
      autoSplit: options.autoSplit,
      noAI: options.noAi,
      requireQuality: options.requireQuality ? parseInt(options.requireQuality, 10) : undefined,
      decompose: options.decompose,
    });
  });

// doctor command
program
  .command('doctor')
  .description('Run environment diagnostics, check and fix setup issues')
  .option('--fix', 'Auto-fix detected issues')
  .option('--deep', 'Deep log analysis: run all log analyzers (rule + AI hybrid strategy)')
  .option('--bug-report', 'Generate Bug report (includes log compression attachment, AI cost summary, usage analysis)')
  .action(async (options) => {
    if (options.bugReport) {
      await runBugReport();
    } else if (options.deep) {
      await runDoctorDeep();
    } else {
      await runDoctor(options.fix);
    }
  });


// headless-harness-design command
program
  .command('headless-harness-design [action]')
  .description('Execute task plan using Harness Design pattern (automated dev & review)\n\nMain Options:\n  --plan <file>              Plan file path (default: auto read/generate)\n  --max-retries <n>          Max retry attempts (default: 3)\n  --timeout <seconds>        Per-task timeout in seconds (default: 300)\n  --parallel <n>             Parallel execution count (default: 1)\n  --dry-run                  Dry run mode (no actual execution)\n  --continue                 Continue from last interruption\n  --json                     JSON format output\n  --batch-git-commit         Auto git commit after each batch\n\nQuality Gate Options:\n  --require-quality <n>      Quality score threshold (0-100, default: 60)\n  --skip-harness-gate        Skip harness quality gate check (not recommended)\n\nAPI Options:\n  --api-retry-attempts <n>   API retry attempts for 429/500 errors (default: 3)\n  --api-retry-delay <seconds>  API retry base delay in seconds (default: 60)\n\nSub-command: cleanup\n  cleanup                    Clean up orphaned snapshots\n  --force                    Force cleanup all snapshots (including active ones)\n  --orphans-only             Clean only orphaned snapshots (process no longer exists)\n\nDeprecated Options:\n  ~~--skip-quality-gate~~    Deprecated, use --skip-harness-gate instead')
  .option('--plan <file>', 'Plan file path (optional, auto-read/generate if not specified)')
  .option('--max-retries <n>', 'Max retry attempts', '3')
  .option('--timeout <seconds>', 'Per-task timeout (seconds)', '300')
  .option('--parallel <n>', 'Parallel execution count', '1')
  .option('--dry-run', 'Dry run mode (no actual execution)')
  .option('--continue', 'Continue from last interruption')
  .option('--json', 'JSON format output')
  .option('--api-retry-attempts <n>', 'API call retry attempts (for 429/500 errors)', '3')
  .option('--api-retry-delay <seconds>', 'API retry base delay (seconds)', '60')
  .option('--require-quality <n>', 'Quality gate: minimum quality score threshold (0-100, default 60)', '60')
  .option('--skip-harness-gate', 'Skip Harness pre-execution quality gate check (not recommended)')
  .option('--skip-quality-gate', '[Deprecated] Use --skip-harness-gate instead')
  .option('--batch-git-commit', 'Auto git commit after each batch completes')
  .option('--force', 'Force cleanup all snapshots (cleanup subcommand only)')
  .option('--orphans-only', 'Clean only orphaned snapshots (cleanup subcommand only)')
  .action(async (action, options) => {
    requireInit();

    // Handle cleanup subcommand
    if (action === 'cleanup') {
      await cleanupHarnessSnapshots({
        force: options.force,
        orphansOnly: options.orphansOnly,
      });
      return;
    }

    // If unknown subcommand, report error
    if (action && action !== 'cleanup') {
      console.error("(X) Error: Unknown sub-command '" + action + "'");
      console.error('');
      console.error('Supported sub-commands:');
      console.error('  cleanup    Clean up orphaned snapshots');
      console.error('');
      console.error('Examples:');
      console.error('  projmnt4claude headless-harness-design                    # Run pipeline');
      console.error('  projmnt4claude headless-harness-design cleanup           # Clean orphans');
      console.error('  projmnt4claude headless-harness-design cleanup --force   # Force cleanup');
      process.exit(1);
    }

    // Run main command
    await harnessCommand({
      plan: options.plan,
      maxRetries: options.maxRetries,
      timeout: options.timeout,
      parallel: options.parallel,
      dryRun: options.dryRun,
      continue: options.continue,
      json: options.json,
      apiRetryAttempts: options.apiRetryAttempts,
      apiRetryDelay: options.apiRetryDelay,
      requireQuality: options.requireQuality,
      skipHarnessGate: options.skipHarnessGate || options.skipQualityGate,
      batchGitCommit: options.batchGitCommit,
    });
  });


// help command
program
  .command('help [topic]')
  .description('Show help information\n  - No args: Show overall help overview\n  - Command name (e.g., task/plan/config): Show detailed help for that command\n  - Other args: Answer related questions intelligently')
  .action((topic) => {
    showHelp(topic);
  });

// Improve unknown command error hint
program.on('command:*', (operands) => {
  const unknownCmd = operands[0];
  const taskSubcommands = ['list', 'show', 'create', 'update', 'delete', 'execute', 'checkpoint', 'dependency', 'add-subtask'];

  console.error("(X) Error: Unknown command '" + unknownCmd + "'");
  console.error('');

  // Detect if task subcommand is mistakenly used as top-level command
  if (taskSubcommands.includes(unknownCmd)) {
    console.error('[!] Hint: \'%s\' is a task sub-command, use:', unknownCmd);
    console.error('   projmnt4claude task %s [options]', unknownCmd);
  } else {
    console.error('[!] Available commands:');
    console.error('   task, status, analyze, init-requirement, setup, doctor, help');
  }

  console.error('');
  console.error('For full help: projmnt4claude help');
  process.exit(1);
});

program.parse();
