---
name: projmnt4claude
description: Claude Code 项目管理技能。用于管理任务、执行计划、工具箱、钩子系统、Git分支集成等。当用户提到"任务管理"、"项目管理"、"创建任务"、"执行计划"时使用。
---

# projmnt4claude - Claude Code 项目管理技能

一个专为 Claude Code 设计的项目管理技能，帮助管理开发任务、执行计划、本地工具箱、钩子系统和 Git 分支集成。

## 快速开始

### 初始化项目

在用户项目中初始化项目管理环境：

```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js setup
```

这将在用户项目根目录创建 `.projmnt4claude/` 目录结构。

## 核心命令

### 任务管理

| 命令 | 描述 |
|------|------|
| `task create` | 交互式创建新任务 |
| `task list [--status] [--priority] [--role]` | 列出任务，支持过滤 |
| `task show <id>` | 显示任务详情 |
| `task update <id> [options]` | 更新任务属性 |
| `task delete <id>` | 删除任务（归档） |
| `task execute <id>` | 引导执行任务 |
| `task checkpoint <id>` | 完成检查点 |
| `task dependency add/remove <id> <depId>` | 管理任务依赖 |

### 执行计划

| 命令 | 描述 |
|------|------|
| `plan show [--json]` | 显示当前执行计划 |
| `plan add <id> [--after]` | 添加任务到计划 |
| `plan remove <id>` | 从计划移除任务 |
| `plan clear [--force]` | 清空计划 |
| `plan recommend` | 智能推荐执行计划 |

### 工具箱管理

| 命令 | 描述 |
|------|------|
| `tool list [--json]` | 列出本地 skill |
| `tool create` | 创建新 skill 脚手架 |
| `tool install <source>` | 安装 skill |
| `tool remove <name>` | 删除 skill |
| `tool deploy <name>` | 部署 skill 到 Claude Code |
| `tool undeploy <name>` | 卸载 skill |

### 项目分析

| 命令 | 描述 |
|------|------|
| `status` | 显示项目状态摘要 |
| `analyze [--fix]` | 分析项目健康状态 |

### 帮助系统

| 命令 | 描述 |
|------|------|
| `help [command|topic]` | 显示命令使用说明和帮助信息 |

### 钩子系统

| 命令 | 描述 |
|------|------|
| `hook enable` | 启用钩子系统 |
| `hook disable` | 禁用钩子系统 |
| `hook status` | 显示钩子状态 |

### Git 分支集成

| 命令 | 描述 |
|------|------|
| `branch checkout <id>` | 切换到任务关联分支 |
| `branch status` | 显示分支状态 |
| `branch create <id>` | 创建任务分支 |
| `branch delete <id>` | 删除任务分支 |
| `branch merge <id>` | 合并任务分支 |
| `branch push <id>` | 推送任务分支 |
| `branch sync` | 同步分支状态 |

### 自然语言需求

| 命令 | 描述 |
|------|------|
| `init-requirement "<description>"` | 从自然语言描述创建任务 |

### 帮助系统

| 命令 | 描述 |
|------|------|
| `help [command|topic]` | 显示命令使用说明和帮助信息 |

## 帮助命令详解

`help` 命令提供了灵活的帮助系统，支持三种使用方式：

### 1. 显示整体帮助

无参数时显示所有可用命令的简要说明：

```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js help
```

输出：
- 所有可用命令列表
- 每个命令的简要描述
- 快速导航提示

### 2. 显示特定命令帮助

指定命令名显示该命令的详细说明：

```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js help status
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js help task
```

输出：
- 命令的详细描述
- 所有用法示例
- 参数和选项说明
- 相关命令链接

### 3. 智能问答

支持自然语言查询，根据上下文提供相关解答：

```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js help "how to create task"
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js help "task dependencies"
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js help "project status"
```

特性：
- 模糊匹配：支持部分命令名查询
- 自动补全：Tab 键补全命令名
- 链接帮助：相关命令互相链接

## 使用示例

### 示例 1: 查看所有命令

当用户说 "有哪些可用命令"：
```bash
help
```

### 示例 2: 学习特定命令

当用户说 "怎么使用 task 命令"：
```bash
help task
```

### 示例 3: 快速解答

当用户问 "如何添加任务到执行计划"：
```bash
help "plan add"
```

## 使用示例

### 示例 1: 创建并执行任务

当用户说 "帮我创建一个任务，实现用户登录功能"：

1. 使用 `init-requirement` 分析需求：
```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js init-requirement "实现用户登录功能，需要支持邮箱和密码登录"
```

2. 或使用 `task create` 手动创建：
```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js task create
```

3. 将任务添加到执行计划：
```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js plan add <task-id>
```

4. 执行任务：
```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js task execute <task-id>
```

### 示例 2: 查看项目状态

当用户说 "项目进展如何" 或 "有什么任务"：

```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js status
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js task list
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js plan show
```

### 示例 3: 分析项目健康状态

当用户说 "检查一下项目状态" 或 "有什么问题"：

```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js analyze
```

自动修复检测到的问题：
```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js analyze --fix
```

### 示例 4: Git 工作流

当用户说 "切换到某个任务分支"：

```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js branch checkout <task-id>
```

## 任务优先级

| 优先级 | 标识 | 描述 |
|--------|------|------|
| 低 | `low` | 可选任务 |
| 中 | `medium` | 常规任务（默认） |
| 高 | `high` | 重要任务 |
| 紧急 | `urgent` | 紧急任务 |

## 任务状态

| 状态 | 描述 |
|------|------|
| `open` | 新建任务 |
| `in_progress` | 进行中 |
| `blocked` | 被阻塞 |
| `resolved` | 已完成 |
| `reopened` | 重新打开 |
| `abandoned` | 已放弃 |

## 数据存储

所有数据存储在用户项目的 `.projmnt4claude/` 目录：

```
用户项目/
└── .projmnt4claude/
    ├── config.json          # 项目配置
    ├── tasks/               # 任务目录
    │   └── TASK-001/
    │       ├── meta.json    # 任务元数据
    │       └── checkpoint.md # 检查点
    ├── archive/             # 归档任务
    ├── toolbox/             # 本地 skill
    ├── hooks/               # 钩子脚本
    └── reports/             # 分析报告
```

## 命令调用方式

在 Claude Code 中，使用以下方式调用 CLI：

```bash
# ${CLAUDE_PLUGIN_ROOT} 是插件安装目录的环境变量
# 或使用绝对路径

node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js <command> [options]
```

## 注意事项

1. **初始化**: 使用任何命令前，必须先在用户项目中运行 `setup`
2. **Git 集成**: 分支命令需要在 Git 仓库中运行
3. **依赖管理**: 添加依赖时会自动检测循环依赖
4. **任务归档**: 删除的任务会移至 `archive/` 目录，可恢复

## 更多帮助

查看命令帮助：
```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js --help
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js <command> --help
```
