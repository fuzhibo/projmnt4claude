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
  enableHook,
  disableHook,
  showHookStatus,
} from './commands/hook';
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
  .version('0.1.0');

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
  .description('管理任务 (create/list/show/update/delete/execute/checkpoint/dependency/add-subtask/status-guide/complete)')
  .allowExcessArguments(true)
  .option('-s, --status <status>', '按状态过滤 (仅 list)')
  .option('-p, --priority <priority>', '按优先级过滤 (仅 list)')
  .option('-r, --role <role>', '按推荐角色过滤 (仅 list)')
  .option('--dep-id <depId>', '依赖任务ID (仅 dependency)')
  .option('--title <title>', '任务标题 (仅 create/update)')
  .option('--description <description>', '任务描述 (仅 create/update)')
  .option('--type <type>', '任务类型 (仅 create): bug/feature/research/docs/refactor/test')
  .option('-y, --yes', '非交互模式 (仅 create/checkpoint)')
  .option('--token <token>', '检查点确认令牌 (仅 update)')
  .option('--sync-children', '同步子任务状态 (仅 update resolved/closed)')
  .option('--no-sync', '不同步子任务状态 (仅 update)')
  .option('--topic <topic>', '讨论主题 (仅 discuss)')
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
        });
        break;
      case 'show':
        if (!id) {
          console.error('错误: show 操作需要指定任务ID');
          process.exit(1);
        }
        showTask(id);
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
        // Check for verify subcommand (process.argv[4] or process.argv[5] might)
        if (process.argv[4] === 'verify' || process.argv[5] === 'verify') {
          await verifyCheckpoint(id);
        } else {
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
      default:
        console.error(`错误: 未知操作 '${action}'。支持的操作: create, list, show, update, delete, execute, checkpoint, dependency, discuss, add-subtask, sync-children`);
        process.exit(1);
    }
  });

// plan 命令组
program
  .command('plan <action> [id]')
  .description('管理执行计划 (show/add/remove/clear/recommend)')
  .option('-j, --json', '以 JSON 格式输出 (仅 show)')
  .option('-f, --force', '强制执行，跳过确认 (仅 clear)')
  .option('-a, --after <taskId>', '在指定任务之后添加 (仅 add)')
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
        await recommendPlan();
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
  .action((options) => {
    requireInit();
    showStatus(options.archived || options.all);
  });

// analyze 命令
program
  .command('analyze')
  .description('分析项目健康状态')
  .option('--fix', '自动修复检测到的问题')
  .option('-y, --yes', '非交互模式：自动修复可修复的问题')
  .action(async (options) => {
    requireInit();
    if (options.fix) {
      await fixIssues(process.cwd(), options.yes);
    } else {
      showAnalysis();
    }
  });

// hook 命令组
program
  .command('hook <action>')
  .description('管理钩子会话 (enable/disable/status)')
  .option('-y, --yes', '非交互模式，使用默认钩子配置 (仅 enable)')
  .option('--hooks <hooks>', '指定要启用的钩子，逗号分隔 (仅 enable，如: pre-commit,pre-push)')
  .action(async (action, options) => {
    requireInit();
    switch (action) {
      case 'enable':
        await enableHook({
          nonInteractive: options.yes,
          hooks: options.hooks,
        });
        break;
      case 'disable':
        await disableHook();
        break;
      case 'status':
        showHookStatus();
        break;
      default:
        console.error(`错误: 未知操作 '${action}'。支持的操作: enable, disable, status`);
        process.exit(1);
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


// help 命令
program
  .command('help [topic]')
  .description('显示帮助信息\n  - 无参数: 显示整体帮助概览\n  - 匽令名 (如 task/plan/config): 显示该命令详细帮助\n  - 其他参数: 智能回答相关问题')
  .action((topic) => {
    showHelp(topic);
  });

program.parse();
