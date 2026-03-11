# projmnt4claude - Claude Code Project Management Skill

[中文](#中文文档) | **English**

A project management skill designed for Claude Code, providing task management, execution planning, toolbox, hook system, and Git branch integration.

## Features

- **Task Management** - Create, view, update, delete tasks with dependency management and status tracking
- **Execution Planning** - Intelligent execution order recommendation, manual plan adjustment
- **Subtask Support** - Create subtasks under parent tasks with progress tracking
- **Project Analysis** - Health analysis, status summary, issue detection
- **Hook System** - Integrate with Git events, automate workflows
- **Branch Integration** - Link tasks with Git branches, auto switch/create
- **Natural Language Parsing** - Auto-create structured tasks from natural descriptions
- **i18n Support** - Bilingual interface (Chinese/English)

## Installation

### Option 1: Install from Marketplace

```bash
# Add marketplace
/plugin marketplace add fuzhibo/projmnt4claude

# Install plugin
/plugin install projmnt4claude
```

### Option 2: Local Development

```bash
# Clone repository
git clone https://github.com/fuzhibo/projmnt4claude.git
cd projmnt4claude

# Install dependencies
bun install

# Build CLI
bun run build

# Install in Claude Code
/plugin install /path/to/projmnt4claude
```

## Quick Start

### 1. Initialize Project

Initialize in your project:

```bash
node $PLUGIN_DIR/skills/projmnt4claude/dist/projmnt4claude.js setup
```

This creates a `.projmnt4claude/` directory structure in your project root.

### 2. Create Tasks

Using natural language:

```bash
node $PLUGIN_DIR/skills/projmnt4claude/dist/projmnt4claude.js init-requirement "Implement user login API"
```

Or interactive mode:

```bash
node $PLUGIN_DIR/skills/projmnt4claude/dist/projmnt4claude.js task create
```

### 3. Manage Execution Plan

```bash
# View recommended plan
node $PLUGIN_DIR/skills/projmnt4claude/dist/projmnt4claude.js plan recommend

# View current plan
node $PLUGIN_DIR/skills/projmnt4claude/dist/projmnt4claude.js plan show

# Add task to plan
node $PLUGIN_DIR/skills/projmnt4claude/dist/projmnt4claude.js plan add TASK-001
```

### 4. View Project Status

```bash
node $PLUGIN_DIR/skills/projmnt4claude/dist/projmnt4claude.js status
```

## Usage in Claude Code

After installation, use slash commands directly in Claude Code:

```
/projmnt4claude:task list
/projmnt4claude:plan recommend
/projmnt4claude:init-requirement "Implement user authentication"
/projmnt4claude:status
/projmnt4claude:analyze
```

## Command Reference

### Task Management

| Command | Description |
|---------|-------------|
| `task create` | Create new task |
| `task list [--status] [--priority] [--role]` | List tasks |
| `task show <id>` | Show task details |
| `task update <id> [options]` | Update task |
| `task delete <id>` | Delete task |
| `task execute <id>` | Execute task |
| `task add-subtask <parentId> <title>` | Add subtask |

### Execution Planning

| Command | Description |
|---------|-------------|
| `plan show [--json]` | Show plan |
| `plan add <id> [--after]` | Add task |
| `plan remove <id>` | Remove task |
| `plan clear` | Clear plan |
| `plan recommend` | Smart recommendation |

### Project Analysis

| Command | Description |
|---------|-------------|
| `status` | Project status summary |
| `analyze [--fix]` | Analyze project health |

### Natural Language

| Command | Description |
|---------|-------------|
| `init-requirement "<desc>"` | Create tasks from description |

## Data Structure

```
your-project/
└── .projmnt4claude/
    ├── config.json          # Project config
    ├── tasks/               # Tasks directory
    │   └── TASK-001/
    │       ├── meta.json    # Task metadata
    │       └── checkpoint.md
    ├── archive/             # Archived tasks
    ├── toolbox/             # Local skills
    ├── hooks/               # Hook scripts
    ├── current-plan.json    # Execution plan
    └── reports/             # Analysis reports
```

## Task Metadata

```typescript
interface TaskMeta {
  id: string;                    // Task ID
  title: string;                 // Title
  description?: string;          // Description
  status: TaskStatus;            // Status
  priority: TaskPriority;        // Priority (P0-P3, Q1-Q4)
  dependencies: string[];        // Dependencies
  recommendedRole?: string;      // Recommended role
  branch?: string;               // Linked branch
  parentId?: string;             // Parent task ID (for subtasks)
  subtaskIds?: string[];         // Subtask IDs
  createdAt: string;             // Created at
  updatedAt: string;             // Updated at
}
```

## Development

```bash
# Install dependencies
bun install

# Run CLI (dev mode)
bun run src/index.ts --help

# Build CLI
bun run build

# Type check
bunx tsc --noEmit
```

## Tech Stack

- TypeScript
- Bun Runtime
- Commander.js (CLI parsing)
- prompts (interactive input)

## License

GNU Affero General Public License v3.0 (AGPLv3)

---

# 中文文档

[English](#projmnt4claude---claude-code-project-management-skill) | **中文**

专为 Claude Code 设计的项目管理技能，提供任务管理、执行计划、工具箱、钩子系统和 Git 分支集成功能。

## 功能特性

- **任务管理** - 创建、查看、更新、删除任务，支持依赖管理和状态跟踪
- **执行计划** - 智能推荐执行顺序，手动调整计划
- **子任务支持** - 在父任务下创建子任务，支持进度跟踪
- **项目分析** - 健康分析、状态摘要、问题检测
- **钩子系统** - 与 Git 事件联动，自动化工作流
- **分支集成** - 任务与 Git 分支关联，自动切换创建
- **自然语言解析** - 从自然描述自动创建结构化任务
- **国际化支持** - 双语界面（中文/英文）

## 安装

### 方式 1: 从 Marketplace 安装

```bash
# 添加 marketplace
/plugin marketplace add fuzhibo/projmnt4claude

# 安装插件
/plugin install projmnt4claude
```

### 方式 2: 本地开发安装

```bash
# 克隆仓库
git clone https://github.com/fuzhibo/projmnt4claude.git
cd projmnt4claude

# 安装依赖
bun install

# 打包 CLI
bun run build

# 在 Claude Code 中安装
/plugin install /path/to/projmnt4claude
```

## 快速开始

### 1. 初始化项目

在用户项目中初始化：

```bash
node $PLUGIN_DIR/skills/projmnt4claude/dist/projmnt4claude.js setup
```

这将在用户项目根目录创建 `.projmnt4claude/` 目录结构。

### 2. 创建任务

使用自然语言创建：

```bash
node $PLUGIN_DIR/skills/projmnt4claude/dist/projmnt4claude.js init-requirement "实现用户登录API接口"
```

或交互式创建：

```bash
node $PLUGIN_DIR/skills/projmnt4claude/dist/projmnt4claude.js task create
```

### 3. 管理执行计划

```bash
# 查看推荐计划
node $PLUGIN_DIR/skills/projmnt4claude/dist/projmnt4claude.js plan recommend

# 查看当前计划
node $PLUGIN_DIR/skills/projmnt4claude/dist/projmnt4claude.js plan show

# 添加任务到计划
node $PLUGIN_DIR/skills/projmnt4claude/dist/projmnt4claude.js plan add TASK-001
```

### 4. 查看项目状态

```bash
node $PLUGIN_DIR/skills/projmnt4claude/dist/projmnt4claude.js status
```

## 在 Claude Code 中使用

安装后，可以在 Claude Code 对话中直接使用斜杠命令：

```
/projmnt4claude:task list
/projmnt4claude:plan recommend
/projmnt4claude:init-requirement "实现用户认证功能"
/projmnt4claude:status
/projmnt4claude:analyze
```

## 命令参考

### 任务管理

| 命令 | 描述 |
|------|------|
| `task create` | 创建新任务 |
| `task list [--status] [--priority] [--role]` | 列出任务 |
| `task show <id>` | 显示任务详情 |
| `task update <id> [options]` | 更新任务 |
| `task delete <id>` | 删除任务 |
| `task execute <id>` | 执行任务 |
| `task add-subtask <parentId> <title>` | 添加子任务 |

### 执行计划

| 命令 | 描述 |
|------|------|
| `plan show [--json]` | 显示计划 |
| `plan add <id> [--after]` | 添加任务 |
| `plan remove <id>` | 移除任务 |
| `plan clear` | 清空计划 |
| `plan recommend` | 智能推荐 |

### 项目分析

| 命令 | 描述 |
|------|------|
| `status` | 项目状态摘要 |
| `analyze [--fix]` | 分析项目健康状态 |

### 自然语言

| 命令 | 描述 |
|------|------|
| `init-requirement "<desc>"` | 从描述创建任务 |

## 数据结构

```
用户项目/
└── .projmnt4claude/
    ├── config.json          # 项目配置
    ├── tasks/               # 任务目录
    │   └── TASK-001/
    │       ├── meta.json    # 任务元数据
    │       └── checkpoint.md
    ├── archive/             # 归档任务
    ├── toolbox/             # 本地 skill
    ├── hooks/               # 钩子脚本
    ├── current-plan.json    # 执行计划
    └── reports/             # 分析报告
```

## 任务元数据

```typescript
interface TaskMeta {
  id: string;                    // 任务ID
  title: string;                 // 标题
  description?: string;          // 描述
  status: TaskStatus;            // 状态
  priority: TaskPriority;        // 优先级 (P0-P3, Q1-Q4)
  dependencies: string[];        // 依赖
  recommendedRole?: string;      // 推荐角色
  branch?: string;               // 关联分支
  parentId?: string;             // 父任务ID (子任务用)
  subtaskIds?: string[];         // 子任务ID列表
  createdAt: string;             // 创建时间
  updatedAt: string;             // 更新时间
}
```

## 开发

```bash
# 安装依赖
bun install

# 运行 CLI (开发模式)
bun run src/index.ts --help

# 打包 CLI
bun run build

# 类型检查
bunx tsc --noEmit
```

## 技术栈

- TypeScript
- Bun 运行时
- Commander.js (CLI 解析)
- prompts (交互式输入)

## 许可证

GNU Affero General Public License v3.0 (AGPLv3)
