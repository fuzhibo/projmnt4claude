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
import { runDoctor } from './commands/doctor';
import { harnessCommand } from './commands/harness';
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
  .description('管理任务 (create/list/show/update/delete/execute/checkpoint/dependency/add-subtask/status-guide/complete/split/search/batch-update/count)')
  .allowExcessArguments(true)
  .option('-s, --status <status>', '按状态过滤 (仅 list)')
  .option('-p, --priority <priority>', '按优先级过滤 (仅 list)')
  .option('-r, --role <role>', '按推荐角色过滤 (仅 list)')
  .option('--dep-id <depId>', '依赖任务ID (仅 dependency)')
  .option('--title <title>', '任务标题 (仅 create/update)')
  .option('--description <description>', '任务描述 (仅 create/update)')
  .option('--type <type>', '任务类型 (create/count): bug/feature/research/docs/refactor/test')
  .option('-y, --yes', '非交互模式 (仅 create/checkpoint)')
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
  .option('--result <result>', '验证结果 (仅 checkpoint complete)')
  .option('--note <note>', '检查点备注 (仅 checkpoint note/fail)')
  .option('--into <count>', '拆分数量 (仅 split)')
  .option('--titles <titles>', '子任务标题列表，仅 split,')
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
        });
        break;
      case 'list':
        listTasks({
          status: options.status,
          priority: options.priority,
          role: options.role,
          fields: options.fields,
          format: options.json ? 'json' : undefined,
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
          json: options.json,
          compact: options.compact,
          checkpoints: options.checkpoints,
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
        await deleteTask(id);
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
        if (!id) {
          console.error('错误: dependency 操作需要指定子操作和任务ID');
          console.error('用法: task dependency add <taskId> --dep-id <depId>');
          console.error('      task dependency remove <taskId> --dep-id <depId>');
          process.exit(1);
        }

        // id 应该是 'add' 或 'remove'
        if (id !== 'add' && id !== 'remove') {
          console.error(`错误: 未知的子操作 '${id}'，支持: add, remove`);
          process.exit(1);
        }

        // 从 process.argv 获取 taskId (在 add/remove 之后)
        const depIndex = process.argv.indexOf('dependency');
        const taskId = process.argv[depIndex + 2]; // 跳过 'dependency' 和 'add/remove'

        if (!taskId || taskId.startsWith('-')) {
          console.error('错误: 需要指定任务ID');
          console.error('用法: task dependency add <taskId> --dep-id <depId>');
          process.exit(1);
        }

        if (!options.depId) {
          console.error('错误: 需要指定 --dep-id');
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
        countTasks({
          status: options.status,
          priority: options.priority,
          type: options.type,
          groupBy: options.group as 'status' | 'priority' | 'type' | 'role' | undefined,
          json: options.json || false,
        });
        break;
      }
      default:
        console.error(`错误: 未知操作 '${action}'。支持的操作: create, list, show, update, delete, execute, checkpoint, dependency, discuss, add-subtask, sync-children, split, search, batch-update, submit, validate, history, status-guide, complete, count`);
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
  .action((options) => {
    requireInit();
    showStatus({
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
  .option('--fix', '自动修复检测到的问题')
  .option('-y, --yes', '非交互模式：自动修复可修复的问题')
  .option('--compact', '使用简洁分隔符')
  .action(async (options) => {
    requireInit();
    if (options.fix) {
      await fixIssues(process.cwd(), options.yes);
    } else {
      showAnalysis({ compact: options.compact });
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
  .description('从自然语言需求描述创建任务，自动解析需求并生成任务结构\n示例: init-requirement "实现用户登录功能，包含表单验证和 JWT 认证"')
  .option('-y, --yes', '非交互模式：跳过所有确认，直接使用分析结果创建任务')
  .option('--no-plan', '创建任务后不询问是否添加到执行计划')
  .action(async (description, options) => {
    requireInit();
    await initRequirement(description, process.cwd(), { nonInteractive: options.yes, noPlan: options.noPlan });
  });

// doctor 命令
program
  .command('doctor')
  .description('运行环境诊断，检查并修复设置问题')
  .option('--fix', '自动修复检测到的问题')
  .action(async (options) => {
    await runDoctor(options.fix);
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
    });
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
