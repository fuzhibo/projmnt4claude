#!/usr/bin/env bun
import { Command } from 'commander';
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
} from './commands/task';
import {
  showPlan,
  addTask,
  removeTask,
  clearPlanCmd,
  recommendPlan,
} from './commands/plan';
import {
  listTools,
  createTool,
  installTool,
  removeTool,
  deployTool,
  undeployTool,
} from './commands/tool';
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
import {
  checkoutTaskBranch,
  showBranchStatus,
  createTaskBranch,
  deleteTaskBranch,
  mergeTaskBranch,
  pushTaskBranch,
  syncBranch,
} from './commands/branch';
import { initRequirement } from './commands/init-requirement';
import { showHelp } from './commands/help';
import { runDoctor, runBugReport } from './commands/doctor';
import { harnessCommand } from './commands/harness';
import {
  listHumanVerifications,
  approveHumanVerification,
  rejectHumanVerification,
  batchHumanVerification,
  showVerificationReport,
} from './commands/human-verification';
import { isInitialized } from './utils/path';

/**
 * 检查项目是否已初始化，未初始化则报错退出
 */
function requireInit(): void {
  if (!isInitialized()) {
    console.error('❌ 错误: 项目尚未初始化');
    console.error('');
    console.error('请先运行以下命令初始化项目管理环境:');
    console.error('  projmnt4claude setup');
    console.error('');
    console.error('或者使用 slash command:');
    console.error('  /projmnt4claude:setup');
    process.exit(1);
  }
}

const program = new Command();

program
  .name('projmnt4claude')
  .description('Claude Code 项目管理 CLI 工具')
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

// setup 命令
program
  .command('setup')
  .description('在当前项目初始化项目管理环境，支持语言选择 (中文/English)')
  .option('-y, --yes', '非交互模式：跳过所有确认，使用默认设置')
  .option('-l, --language <language>', '指定语言 (zh/en)')
  .option('-f, --force', '强制重新初始化（重新复制技能文件）')
  .action(async (options) => {
    await setup(process.cwd(), { nonInteractive: options.yes, language: options.language, force: options.force });
  });

// config 命令组
program
  .command('config <action> [key] [value]')
  .description('管理配置 (list/get/set)')
  .action((action, key, value) => {
    requireInit();
    switch (action) {
      case 'list':
        listConfig();
        break;
      case 'get':
        if (!key) {
          console.error('错误: get 操作需要指定 key');
          process.exit(1);
        }
        getConfig(key);
        break;
      case 'set':
        if (!key || value === undefined) {
          console.error('错误: set 操作需要指定 key 和 value');
          process.exit(1);
        }
        setConfig(key, value);
        break;
      default:
        console.error(`错误: 未知操作 '${action}'。支持的操作: list, get, set`);
        process.exit(1);
    }
  });

// task 命令组
program
  .command('task <action> [id]')
  .description(`管理任务

基本操作: create/list/show/update/delete/rename/purge/execute/checkpoint
高级操作: dependency/add-subtask/status-guide/complete/split/search/batch-update/count

⚠️  dependency 子命令格式 (注意参数顺序):
  task dependency <add|remove> <taskId> --dep-id <depTaskId>

  示例:
    task dependency add TASK-001 --dep-id TASK-002    # TASK-001 依赖 TASK-002
    task dependency remove TASK-001 --dep-id TASK-002 # 移除依赖

rename 子命令格式:
  task rename <oldTaskId> <newTaskId>

  示例:
    task rename TASK-001 TASK-feature-new-name`)
  .allowExcessArguments(true)
  .option('-s, --status <status>', '按状态过滤 (仅 list)')
  .option('-p, --priority <priority>', '按优先级过滤 (仅 list)')
  .option('-r, --role <role>', '按推荐角色过滤 (仅 list)')
  .option('--dep-id <depId>', '依赖任务ID (仅 dependency)')
  .option('--title <title>', '任务标题 (仅 create/update)')
  .option('--description <description>', '任务描述 (仅 create/update)')
  .option('--type <type>', '任务类型 (create/count): bug/feature/research/docs/refactor/test')
  .option('-y, --yes', '非交互模式 (仅 create/checkpoint/delete)')
  .option('--token <token>', '检查点确认令牌 (仅 update)')
  .option('--sync-children', '同步子任务状态 (仅 update resolved/closed)')
  .option('--no-sync', '不同步子任务状态 (仅 update)')
  .option('--topic <topic>', '讨论主题 (仅 discuss)')
  // 新增选项 (bug_report_4.md)
  .option('-v, --verbose', '显示完整信息 (仅 show)')
  .option('--history', '仅显示变更历史 (仅 show)')
  .option('--json', 'JSON 格式输出 (仅 show/list/status/count)')
  .option('--compact', '精简输出 (仅 show)')
  .option('--fields <fields>', '自定义输出字段 (仅 list)')
  .option('--missing-verification', '筛选缺少验证的任务 (仅 list)')
  .option('-g, --group <field>', '分组显示 (仅 list): status/priority/type/role')
  .option('--checkpoints', '显示检查点详情 (仅 show)')
  .option('--format <format>', '输出格式 (仅 show): panel/classic')
  .option('--result <result>', '验证结果 (仅 checkpoint complete)')
  .option('--note <note>', '检查点备注 (仅 checkpoint note/fail)')
  .option('--into <count>', '拆分数量 (仅 split)')
  .option('--titles <titles>', '子任务标题列表，仅 split,')
  .option('--skip-validation', '跳过 checkpoints 质量校验 (仅 create)')
  .action(async (action, id, options) => {
    requireInit();
    switch (action) {
      case 'create':
        await createTask({
          title: options.title,
          description: options.description,
          priority: options.priority,
          type: options.type,
          nonInteractive: options.yes,
          skipValidation: options.skipValidation,
          id: id,  // 传递用户指定的任务ID
        });
        break;
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
      case 'show':
        if (!id) {
          console.error('错误: show 操作需要指定任务ID');
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
          console.error('错误: update 操作需要指定任务ID');
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
        });
        break;
      case 'delete':
        if (!id) {
          console.error('错误: delete 操作需要指定任务ID');
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
          console.error('错误: execute 操作需要指定任务ID');
          process.exit(1);
        }
        await executeTask(id);
        break;
      case 'status-guide':
        showStatusGuide();
        break;
      case 'history':
        if (!id) {
          console.error('错误: history 操作需要指定任务ID');
          process.exit(1);
        }
        showTaskHistory(id);
        break;
      case 'complete':
        if (!id) {
          console.error('错误: complete 操作需要指定任务ID');
          process.exit(1);
        }
        await completeTask(id, { yes: options.yes });
        break;
      case 'checkpoint':
        if (!id) {
          console.error('错误: checkpoint 操作需要指定任务ID');
          process.exit(1);
        }
        // 新增：支持多种 checkpoint 子命令
        // 用法：
        //   task checkpoint <taskId> list
        //   task checkpoint <taskId> <checkpointId> complete --result "xxx"
        //   task checkpoint <taskId> <checkpointId> fail --note "xxx"
        //   task checkpoint <taskId> <checkpointId> note --note "xxx"
        //   task checkpoint <taskId> <checkpointId> show
        //   task checkpoint <taskId> verify (原有功能)

        // 找到 checkpoint 在 process.argv 中的位置
        const checkpointIndex = process.argv.indexOf('checkpoint');
        // checkpoint 后面是 taskId，再后面是子命令
        const afterTaskId = checkpointIndex + 2 < process.argv.length ? process.argv[checkpointIndex + 2] : undefined;
        const afterSubCommand = checkpointIndex + 3 < process.argv.length ? process.argv[checkpointIndex + 3] : undefined;

        // id 是 taskId (从 commander 解析)
        const checkpointSubCmd = afterTaskId;
        const checkpointAct = afterSubCommand;

        if (checkpointSubCmd === 'list') {
          // 列出所有检查点
          await listTaskCheckpoints(id, { json: options.json, compact: options.compact });
        } else if (checkpointSubCmd === 'verify') {
          // 原有功能：验证检查点
          await verifyCheckpoint(id);
        } else if (checkpointSubCmd && checkpointAct) {
          // 检查点操作: task checkpoint <taskId> <checkpointId> <action>
          const validActions = ['complete', 'fail', 'note', 'show'];
          if (!validActions.includes(checkpointAct)) {
            console.error(`错误: 无效的操作 '${checkpointAct}'`);
            console.error(`支持的操作: ${validActions.join(', ')}`);
            process.exit(1);
          }
          await updateCheckpoint(id, checkpointSubCmd, checkpointAct as any, {
            result: options.result,
            note: options.note,
            yes: options.yes,
          });
        } else {
          // 默认行为：完成检查点确认（保持向后兼容）
          await completeCheckpoint(id, { yes: options.yes });
        }
        break;
      case 'discuss':
        if (!id) {
          console.error('错误: discuss 操作需要指定任务ID');
          process.exit(1);
        }
        // discuss 功能已集成到 update 命令的 --needs-discussion 选项中
        console.log('提示: 请使用 task update --needs-discussion 来标记任务需要讨论');
        console.log('      使用 task update --topic "主题内容" 来添加讨论主题');
        break;
      case 'dependency': {
        // 用法: task dependency add <taskId> --dep-id <depId>
        //       task dependency remove <taskId> --dep-id <depId>

        // 显示帮助信息的辅助函数
        const showDependencyHelp = () => {
          console.error('');
          console.error('dependency 子命令用法:');
          console.error('  task dependency add <taskId> --dep-id <depTaskId>');
          console.error('  task dependency remove <taskId> --dep-id <depTaskId>');
          console.error('');
          console.error('示例:');
          console.error('  task dependency add TASK-001 --dep-id TASK-002');
          console.error('  task dependency remove TASK-001 --dep-id TASK-002');
          console.error('');
          console.error('说明:');
          console.error('  - add: 添加依赖关系，表示 taskId 依赖于 depTaskId');
          console.error('  - remove: 移除依赖关系');
          console.error('  - taskId: 要添加/移除依赖的任务ID');
          console.error('  - --dep-id: 被依赖的任务ID');
        };

        if (!id) {
          console.error('❌ 错误: dependency 操作需要指定子操作 (add/remove)');
          showDependencyHelp();
          process.exit(1);
        }

        // id 应该是 'add' 或 'remove'
        if (id !== 'add' && id !== 'remove') {
          // 检测常见错误：用户可能把 taskId 放在了 add/remove 的位置
          if (id.startsWith('TASK-') || id.startsWith('task-')) {
            console.error(`❌ 错误: 参数顺序错误`);
            console.error('');
            console.error(`您输入的是: task dependency ${id} ...`);
            console.error(`正确格式应该是: task dependency <add|remove> ${id} --dep-id <depTaskId>`);
            console.error('');
            console.error(`提示: 子操作 (add/remove) 必须紧跟在 dependency 后面`);
          } else {
            console.error(`❌ 错误: 未知的子操作 '${id}'，支持: add, remove`);
          }
          showDependencyHelp();
          process.exit(1);
        }

        // 从 process.argv 获取 taskId (在 add/remove 之后)
        const depIndex = process.argv.indexOf('dependency');
        const taskId = process.argv[depIndex + 2]; // 跳过 'dependency' 和 'add/remove'

        if (!taskId || taskId.startsWith('-')) {
          console.error('❌ 错误: 需要指定任务ID');
          showDependencyHelp();
          process.exit(1);
        }

        if (!options.depId) {
          console.error('❌ 错误: 需要指定 --dep-id (被依赖的任务ID)');
          console.error('');
          console.error(`示例: task dependency ${id} ${taskId} --dep-id TASK-xxx`);
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
          console.error('错误: add-subtask 操作需要指定父任务ID');
          process.exit(1);
        }
        // title 应该是 process.argv[5] 之后的参数
        const title = process.argv.slice(5).join(' ');
        await addSubtask(id, title);
        break;
      }
      case 'submit': {
        if (!id) {
          console.error('错误: submit 操作需要指定任务ID');
          process.exit(1);
        }
        await submitTask(id, {
          note: options.note,
        });
        break;
      }
      case 'validate': {
        if (!id) {
          console.error('错误: validate 操作需要指定任务ID');
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
          console.error('错误: sync-children 操作需要指定父任务ID');
          process.exit(1);
        }
        await syncChildren(id, {
          targetStatus: options.status,
        });
        break;
      }
      case 'split': {
        if (!id) {
          console.error('错误: split 操作需要指定父任务ID');
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
          console.error('错误: search 操作需要指定搜索关键词');
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
          console.error('错误: rename 操作需要指定旧任务ID和新任务ID');
          console.error('');
          console.error('用法: task rename <oldTaskId> <newTaskId>');
          console.error('示例: task rename TASK-001 TASK-feature-new-name');
          process.exit(1);
        }

        renameTaskCommand(oldTaskId, newTaskId);
        break;
      }
      default:
        console.error(`错误: 未知操作 '${action}'。支持的操作: create, list, show, update, delete, rename, purge, execute, checkpoint, dependency, discuss, add-subtask, sync-children, split, search, batch-update, submit, validate, history, status-guide, complete, count`);
        process.exit(1);
    }
  });

// plan 命令组
program
  .command('plan <action> [id]')
  .description('管理执行计划 (show/add/remove/clear/recommend)')
  .option('-j, --json', '以 JSON 格式输出 (仅 show/recommend)')
  .option('-f, --force', '强制执行，跳过确认 (仅 clear)')
  .option('-a, --after <taskId>', '在指定任务之后添加 (仅 add)')
  .option('-y, --yes', '非交互模式，自动应用推荐 (仅 recommend)')
  .option('-q, --query <query>', '用户描述/关键字过滤 (仅 recommend)')
  .option('--all', '显示全部状态任务，默认仅推荐 open (仅 recommend)')
  .action(async (action, id, options) => {
    requireInit();
    switch (action) {
      case 'show':
        showPlan(options.json);
        break;
      case 'add':
        if (!id) {
          console.error('错误: add 操作需要指定任务ID');
          process.exit(1);
        }
        addTask(id, options.after);
        break;
      case 'remove':
        if (!id) {
          console.error('错误: remove 操作需要指定任务ID');
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
        });
        break;
      default:
        console.error(`错误: 未知操作 '${action}'。支持的操作: show, add, remove, clear, recommend`);
        process.exit(1);
    }
  });

// tool 命令组
program
  .command('tool <action> [name]')
  .description('管理本地 skill (list/create/install/remove/deploy/undeploy)')
  .option('-j, --json', '以 JSON 格式输出 (仅 list)')
  .option('-s, --source <source>', '来源 URL (仅 install)')
  .action(async (action, name, options) => {
    requireInit();
    switch (action) {
      case 'list':
        listTools(options.json);
        break;
      case 'create':
        await createTool();
        break;
      case 'install':
        if (!options.source && !name) {
          console.error('错误: install 操作需要指定来源');
          process.exit(1);
        }
        await installTool(options.source || name);
        break;
      case 'remove':
        if (!name) {
          console.error('错误: remove 操作需要指定 skill 名称');
          process.exit(1);
        }
        await removeTool(name);
        break;
      case 'deploy':
        if (!name) {
          console.error('错误: deploy 操作需要指定 skill 名称');
          process.exit(1);
        }
        deployTool(name);
        break;
      case 'undeploy':
        if (!name) {
          console.error('错误: undeploy 操作需要指定 skill 名称');
          process.exit(1);
        }
        undeployTool(name);
        break;
      default:
        console.error(`错误: 未知操作 '${action}'。支持的操作: list, create, install, remove, deploy, undeploy`);
        process.exit(1);
    }
  });

// status 命令
program
  .command('status')
  .description('显示项目状态摘要')
  .option('--archived', '显示归档任务统计')
  .option('-a, --all', '显示所有任务（包括归档）')
  .option('-q, --quiet', '精简输出：仅显示关键指标')
  .option('--json', 'JSON 格式输出')
  .option('--compact', '使用简洁分隔符')
  .action(async (options) => {
    requireInit();
    await showStatus({
      includeArchived: options.archived || options.all,
      quiet: options.quiet,
      json: options.json,
      compact: options.compact,
    });
  });

// analyze 命令
program
  .command('analyze')
  .description('分析项目健康状态')
  .option('--fix', '自动修复所有可修复的问题')
  .option('--fix-checkpoints', '智能生成缺失的检查点')
  .option('--quality-check', '检测任务内容质量（描述完整度、检查点质量、关联文件、解决方案）')
  .option('--threshold <score>', '质量检测阈值，低于此分数的任务将被标记 (默认: 60)', '60')
  .option('-j, --json', 'JSON 格式输出 (仅 --quality-check)')
  .option('-y, --yes', '非交互模式：自动修复可修复的问题')
  .option('--compact', '使用简洁分隔符')
  .option('--task <taskId>', '指定任务ID (仅 --fix-checkpoints)')
  .option('--deep-analyze', '深度分析: 启用 AI 语义重复检测、陈旧评估、语义质量评分')
  .option('--no-ai', '禁用所有 AI 功能，仅使用规则引擎分析')
  .option('--bug-report <path>', 'Bug Report 分析模式: 分析指定的 bug report 文件或目录')
  .option('--export-training-data', '导出训练数据为 JSONL 格式 (需 --bug-report, 需 config training.exportEnabled)')
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
    } else if (options.fixCheckpoints) {
      await fixCheckpoints(process.cwd(), { nonInteractive: options.yes, taskId: options.task });
    } else if (options.fix) {
      await fixIssues(process.cwd(), { nonInteractive: options.yes, fixType: 'all' });
    } else if (options.qualityCheck) {
      const scores = await performQualityCheck(process.cwd(), aiOptions);
      showQualityReport(scores, {
        compact: options.compact,
        json: options.json || program.opts().json || false,
        threshold: parseInt(options.threshold) || 60,
      });
    } else {
      await showAnalysis({ compact: options.compact, ...aiOptions });
    }
  });

// branch 命令组
program
  .command('branch <action> [id]')
  .description('Git 分支集成 (checkout/status/create/delete/merge/push/sync)')
  .option('-b, --branch-name <branchName>', '分支名称 (仅 create)')
  .option('-m, --message <message>', '合并消息 (仅 merge)')
  .action(async (action, id, options) => {
    requireInit();
    switch (action) {
      case 'checkout':
        if (!id) {
          console.error('错误: checkout 操作需要指定任务ID');
          process.exit(1);
        }
        await checkoutTaskBranch(id);
        break;
      case 'status':
        showBranchStatus();
        break;
      case 'create':
        if (!id) {
          console.error('错误: create 操作需要指定任务ID');
          process.exit(1);
        }
        await createTaskBranch(id, options.branchName);
        break;
      case 'delete':
        if (!id) {
          console.error('错误: delete 操作需要指定任务ID');
          process.exit(1);
        }
        await deleteTaskBranch(id);
        break;
      case 'merge':
        if (!id) {
          console.error('错误: merge 操作需要指定任务ID');
          process.exit(1);
        }
        await mergeTaskBranch(id, options.message);
        break;
      case 'push':
        if (!id) {
          console.error('错误: push 操作需要指定任务ID');
          process.exit(1);
        }
        pushTaskBranch(id);
        break;
      case 'sync':
        syncBranch(id);
        break;
      default:
        console.error(`错误: 未知操作 '${action}'。支持的操作: checkout, status, create, delete, merge, push, sync`);
        process.exit(1);
    }
  });

// init-requirement 命令
program
  .command('init-requirement <description>')
  .description('从自然语言需求描述创建任务，自动解析需求并生成任务结构\n\n' +
    '自动分析: 优先级(P0-P3)、推荐角色、复杂度、检查点、依赖\n' +
    '示例:\n' +
    '  init-requirement "实现用户登录API接口，需要高优先级处理"\n' +
    '  init-requirement -y "紧急修复线上支付接口超时问题"\n' +
    '  init-requirement -y --no-plan "为认证模块编写单元测试"\n\n' +
    '前提: 需先运行 projmnt4claude setup 初始化项目')
  .option('-y, --yes', '非交互模式：跳过所有确认，直接使用分析结果创建任务')
  .option('--no-plan', '创建任务后不询问是否添加到执行计划')
  .option('--skip-validation', '跳过 checkpoints 质量校验')
  .option('--template <type>', '描述模板类型: simple (默认) 或 detailed (详细结构化)', 'simple')
  .option('--auto-split', '自动拆分复杂任务为子任务（复杂度评估为 high 时生效）')
  .option('--no-ai', '禁用 AI 增强，仅使用规则引擎进行关键词匹配分析')
  .action(async (description, options) => {
    requireInit();
    await initRequirement(description, process.cwd(), {
      nonInteractive: options.yes,
      noPlan: options.noPlan,
      skipValidation: options.skipValidation,
      template: options.template,
      autoSplit: options.autoSplit,
      noAI: options.noAi,
    });
  });

// doctor 命令
program
  .command('doctor')
  .description('运行环境诊断，检查并修复设置问题')
  .option('--fix', '自动修复检测到的问题')
  .option('--bug-report', '生成 Bug 报告（含日志压缩附件、AI 成本汇总、使用分析）')
  .action(async (options) => {
    if (options.bugReport) {
      await runBugReport();
    } else {
      await runDoctor(options.fix);
    }
  });


// headless-harness-design 命令
program
  .command('headless-harness-design')
  .description('使用 Harness Design 模式执行任务计划 (自动化开发与审查)')
  .option('--plan <file>', '计划文件路径 (可选，不指定则自动读取/生成)')
  .option('--max-retries <n>', '最大重试次数', '3')
  .option('--timeout <seconds>', '单任务超时时间 (秒)', '300')
  .option('--parallel <n>', '并行执行数', '1')
  .option('--dry-run', '试运行模式 (不实际执行)')
  .option('--continue', '从上次中断处继续执行')
  .option('--json', 'JSON 格式输出')
  .option('--api-retry-attempts <n>', 'API 调用重试次数 (针对 429/500 错误)', '3')
  .option('--api-retry-delay <seconds>', 'API 重试基础延迟 (秒)', '60')
  .option('--require-quality <n>', '质量门禁: 最低质量分阈值 (0-100, 默认 60)', '60')
  .option('--skip-quality-gate', '跳过质量门禁检查 (不推荐)')
  .option('--batch-git-commit', '每个批次完成后自动 git commit')
  .action(async (options) => {
    requireInit();
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
      skipQualityGate: options.skipQualityGate,
      batchGitCommit: options.batchGitCommit,
    });
  });


// human-verification 命令组
program
  .command('human-verification <action> [taskId]')
  .description('管理待人工验证检查点 (list/approve/reject/batch/report)')
  .option('--checkpoint <id>', '指定检查点ID (仅 approve/reject)')
  .option('--reason <reason>', '拒绝原因 (仅 reject)')
  .option('--feedback <feedback>', '验证反馈 (仅 approve/batch)')
  .option('--approve-all', '批准全部待验证 (仅 batch)')
  .option('--status <status>', '按状态过滤: pending/approved/rejected (仅 list)')
  .option('--json', 'JSON 格式输出 (仅 list/report)')
  .action(async (action, taskId, options) => {
    requireInit();
    switch (action) {
      case 'list':
        listHumanVerifications({
          json: options.json || program.opts().json || false,
          status: options.status,
          taskId,
        });
        break;
      case 'approve':
        if (!taskId) {
          console.error('错误: approve 操作需要指定任务ID');
          process.exit(1);
        }
        approveHumanVerification(taskId, {
          checkpoint: options.checkpoint,
          feedback: options.feedback,
        });
        break;
      case 'reject':
        if (!taskId) {
          console.error('错误: reject 操作需要指定任务ID');
          process.exit(1);
        }
        rejectHumanVerification(taskId, {
          checkpoint: options.checkpoint,
          reason: options.reason,
        });
        break;
      case 'batch':
        batchHumanVerification({
          approveAll: options.approveAll,
          feedback: options.feedback,
        });
        break;
      case 'report':
        showVerificationReport({
          json: options.json || program.opts().json || false,
        });
        break;
      default:
        console.error(`错误: 未知操作 '${action}'。支持的操作: list, approve, reject, batch, report`);
        process.exit(1);
    }
  });


// help 命令
program
  .command('help [topic]')
  .description('显示帮助信息\n  - 无参数: 显示整体帮助概览\n  - 匽令名 (如 task/plan/config): 显示该命令详细帮助\n  - 其他参数: 智能回答相关问题')
  .action((topic) => {
    showHelp(topic);
  });

// 改进未知命令错误提示
program.on('command:*', (operands) => {
  const unknownCmd = operands[0];
  const taskSubcommands = ['list', 'show', 'create', 'update', 'delete', 'execute', 'checkpoint', 'dependency', 'add-subtask'];

  console.error(`❌ 错误: 未知命令 '${unknownCmd}'`);
  console.error('');

  // 检测是否是 task 子命令被误用为顶层命令
  if (taskSubcommands.includes(unknownCmd)) {
    console.error('💡 提示: \'%s\' 是 task 子命令的操作，请使用:', unknownCmd);
    console.error('   projmnt4claude task %s [options]', unknownCmd);
  } else {
    console.error('💡 可用命令:');
    console.error('   task, status, analyze, init-requirement, setup, doctor, help');
  }

  console.error('');
  console.error('查看完整帮助: projmnt4claude help');
  process.exit(1);
});

program.parse();
