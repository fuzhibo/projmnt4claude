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

基本操作: create/list/show/get/update/delete/rename/purge/execute/checkpoint
高级操作: dependency/add-subtask/status-guide/complete/split/search/batch-update/batch-update-logs/count

全局选项:
  --token <n>            令牌数估算
  -f, --force            强制操作

create 子命令选项:
  --into <id>            创建为子任务
  --from-requirement     从需求创建
  --requirement-text <text>  需求文本

list 子命令选项:
  --status <status>      过滤状态
  --priority <priority>  过滤优先级
  --type <type>          过滤类型

show 子命令选项:
  --json                 JSON格式输出

update 子命令选项:
  --status <status>      更新状态
  --priority <priority>  更新优先级
  --sync-children        同步子任务

dependency 子命令选项:
  --from <id>            依赖来源
  --to <id>              依赖目标
  --remove               移除依赖

split 子命令选项:
  --parts <n>            拆分数量
  --strategy <strategy>  拆分策略

checkpoint 子命令选项:
  --pass                 通过检查点
  --fail                 失败检查点
  --missing-verification 标记待验证

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
  .option('--token <n>', '令牌数估算')
  .option('--sync-children', '同步子任务状态 (仅 update resolved/closed)')
  .option('--no-sync', '不同步子任务状态 (仅 update)')
  .option('--topic <topic>', '讨论主题 (仅 discuss)')
  // 新增选项 (bug_report_4.md)
  .option('-v, --verbose', '显示完整信息 (仅 show)')
  .option('--history', '仅显示变更历史 (仅 show)')
  .option('--json', 'JSON 格式输出 (仅 show/get/list/status/count)')
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
  .option('-f, --force', '强制操作')
  .option('--file <path>', '从文件读取描述 (仅 create, 用于包含特殊字符的长描述)')
  .option('--from-requirement', '从需求创建 (仅 create)')
  .option('--requirement-text <text>', '需求文本 (仅 create)')
  .option('--branch <branch>', '关联分支 (仅 create)')
  .option('--from <id>', '依赖来源 (仅 dependency)')
  .option('--to <id>', '依赖目标 (仅 dependency)')
  .option('--remove', '移除依赖 (仅 dependency)')
  .option('--parts <n>', '拆分数量 (仅 split)')
  .option('--strategy <strategy>', '拆分策略 (仅 split)')
  .option('--pass', '通过检查点 (仅 checkpoint)')
  .option('--fail', '失败检查点 (仅 checkpoint)')
  .option('--all', '包含所有任务，包括已解决/已关闭的 (仅 batch-update)')
  .option('--tasks <ids>', '指定任务ID列表，逗号分隔 (仅 batch-update)', collectValues, [])
  .option('--task-file <path>', '从文件读取任务ID列表，每行一个或逗号分隔 (仅 batch-update)')
  .option('--change-note <note>', '修改说明，至少10个字符，记录到transitionNotes (仅 batch-update)')
  .option('--source <source>', '过滤日志来源 (仅 batch-update-logs): cli/ide/hook/script/unknown')
  .option('--summary', '显示日志统计摘要 (仅 batch-update-logs)')
  .action(async (action, id, options) => {
    requireInit();
    switch (action) {
      case 'create': {
        let taskDescription = options.description;
        if (options.file) {
          const filePath = path.resolve(options.file);
          if (!fs.existsSync(filePath)) {
            console.error(`❌ 错误: 描述文件不存在: ${filePath}`);
            process.exit(1);
          }
          const stat = fs.statSync(filePath);
          if (!stat.isFile()) {
            console.error(`❌ 错误: 指定路径不是文件: ${filePath}`);
            process.exit(1);
          }
          const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
          if (stat.size > MAX_FILE_SIZE) {
            console.error(`❌ 错误: 描述文件过大 (${(stat.size / 1024 / 1024).toFixed(2)}MB)，最大允许10MB`);
            process.exit(1);
          }
          try {
            taskDescription = fs.readFileSync(filePath, 'utf-8');
          } catch (error: any) {
            console.error(`❌ 错误: 无法读取描述文件: ${error.message}`);
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
          id: id,  // 传递用户指定的任务ID
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
          console.error(`错误: ${action} 操作需要指定任务ID`);
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
        console.error(`错误: 未知操作 '${action}'。支持的操作: create, list, show, update, delete, rename, purge, execute, checkpoint, dependency, discuss, add-subtask, sync-children, split, search, batch-update, batch-update-logs, submit, validate, history, status-guide, complete, count`);
        process.exit(1);
    }
  });

// plan 命令组
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
  .option('--require-quality', '启用质量门禁检查，过滤低质量任务 (仅 recommend)')
  .option('--no-quality-gate', '禁用质量门禁检查 (仅 recommend)')
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
          smart: options.smart,
          strictSubtaskCoverage: options.strictSubtaskCoverage,
          requireQuality: options.qualityGate === false ? false : options.requireQuality || true,
        });
        break;
      default:
        console.error(`错误: 未知操作 '${action}'。支持的操作: show, add, remove, clear, recommend`);
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
  .option('--check-range <range>', '分析范围: all(默认), tasks:ID1,ID2, keyword:pattern')
  .option('--deep-analyze', '深度分析: 启用 AI 语义重复检测、陈旧评估、语义质量评分')
  .option('--no-ai', '禁用所有 AI 功能，仅使用规则引擎分析')
  .option('--rules-only', '仅执行规则分析+修复 (Stage 1,2), 需配合 --fix')
  .option('--checkpoints-only', '仅执行检查点修复 (Stage 4), 需配合 --fix')
  .option('--quality-only', '仅执行质量报告 (Stage 5), 需配合 --fix')
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
    } else if (options.fix) {
      // --fix 流水线模式: 支持 --no-ai, --rules-only, --checkpoints-only, --quality-only
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

// init-requirement 命令
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

    // 优先级: --file > 命令行参数
    if (options.file) {
      const filePath = path.resolve(options.file);

      // 验证文件是否存在
      if (!fs.existsSync(filePath)) {
        console.error(`❌ 错误: 描述文件不存在: ${filePath}`);
        process.exit(1);
      }

      // 验证是否为文件
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) {
        console.error(`❌ 错误: 指定路径不是文件: ${filePath}`);
        process.exit(1);
      }

      // 验证文件大小（限制10MB防止内存问题）
      const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
      if (stat.size > MAX_FILE_SIZE) {
        console.error(`❌ 错误: 描述文件过大 (${(stat.size / 1024 / 1024).toFixed(2)}MB)，最大允许10MB`);
        process.exit(1);
      }

      try {
        finalDescription = fs.readFileSync(filePath, 'utf-8');
      } catch (error: any) {
        console.error(`❌ 错误: 无法读取描述文件: ${error.message}`);
        process.exit(1);
      }

      // 清理临时文件（如果是/tmp下的文件）
      if (filePath.startsWith('/tmp/')) {
        try {
          fs.unlinkSync(filePath);
        } catch {
          // 忽略删除失败
        }
      }
    } else if (description) {
      finalDescription = description;
    }

    // 验证描述必须存在
    if (!finalDescription || finalDescription.trim().length === 0) {
      console.error('❌ 错误: 需要提供描述或使用 --file 选项');
      console.error('');
      console.error('用法:');
      console.error('  projmnt4claude init-requirement "需求描述"');
      console.error('  projmnt4claude init-requirement --file ./description.md');
      console.error('');
      console.error('提示: 当描述包含代码块或特殊字符时，推荐使用 --file 选项');
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

// doctor 命令
program
  .command('doctor')
  .description('运行环境诊断，检查并修复设置问题')
  .option('--fix', '自动修复检测到的问题')
  .option('--deep', '深度日志分析：运行所有日志分析器（规则 + AI 混合策略）')
  .option('--bug-report', '生成 Bug 报告（含日志压缩附件、AI 成本汇总、使用分析）')
  .action(async (options) => {
    if (options.bugReport) {
      await runBugReport();
    } else if (options.deep) {
      await runDoctorDeep();
    } else {
      await runDoctor(options.fix);
    }
  });


// headless-harness-design 命令
program
  .command('headless-harness-design [action]')
  .description(`使用 Harness Design 模式执行任务计划 (自动化开发与审查)

主命令选项:
  --plan <file>              计划文件路径（默认：自动读取/生成）
  --max-retries <n>          最大重试次数（默认：3）
  --timeout <seconds>        单任务超时时间（默认：300秒）
  --parallel <n>             并行执行数（默认：1）
  --dry-run                  试运行模式（不实际执行）
  --continue                 从上次中断处继续执行
  --json                     JSON 格式输出
  --batch-git-commit         每个批次完成后自动 git commit

质量门禁选项:
  --require-quality <n>      质量分阈值（0-100，默认：60）
  --skip-harness-gate        跳过质量门禁检查（不推荐）

API 选项:
  --api-retry-attempts <n>   API 调用重试次数（默认：3）
  --api-retry-delay <seconds>  API 重试基础延迟（默认：60秒）

子命令: cleanup
  cleanup                    清理残留的快照文件
  --force                    强制清理所有快照（包括活跃进程的快照）
  --orphans-only             仅清理孤儿快照（进程已不存在）

Deprecated 选项:
  ~~--skip-quality-gate~~    已弃用，请使用 --skip-harness-gate`)
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
  .option('--skip-harness-gate', '跳过 Harness 执行前质量门禁检查 (不推荐)')
  .option('--skip-quality-gate', '[已弃用] 请使用 --skip-harness-gate')
  .option('--batch-git-commit', '每个批次完成后自动 git commit')
  .option('--force', '强制清理所有快照 (仅 cleanup 子命令)')
  .option('--orphans-only', '仅清理孤儿快照 (仅 cleanup 子命令)')
  .action(async (action, options) => {
    requireInit();

    // 处理 cleanup 子命令
    if (action === 'cleanup') {
      await cleanupHarnessSnapshots({
        force: options.force,
        orphansOnly: options.orphansOnly,
      });
      return;
    }

    // 如果有未知子命令，报错
    if (action && action !== 'cleanup') {
      console.error(`❌ 错误: 未知子命令 '${action}'`);
      console.error('');
      console.error('支持的子命令:');
      console.error('  cleanup    清理残留的快照文件');
      console.error('');
      console.error('用法示例:');
      console.error('  projmnt4claude headless-harness-design                    # 运行流水线');
      console.error('  projmnt4claude headless-harness-design cleanup           # 清理孤儿快照');
      console.error('  projmnt4claude headless-harness-design cleanup --force   # 强制清理所有快照');
      process.exit(1);
    }

    // 运行主命令
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
