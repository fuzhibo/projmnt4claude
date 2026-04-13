# projmnt4claude - Claude Code Project Management Skill

[中文](#projmnt4claude---claude-code项目管理技能) | **English**

A project management skill designed for Claude Code, implementing a **task-centric workflow** with a complete **development → code review → QA verification → evaluation** closed-loop mechanism.

## Core Philosophy

**projmnt4claude** is built around a fundamental principle: **every problem or requirement should be transformed into a task**. Each task follows a rigorous closed-loop process:

- **Investigation & Analysis** - Deep understanding of the problem, root cause analysis
- **Solution Design** - Structured approach with clear implementation plan
- **Development** - Code implementation by specialized agents
- **Code Review** - Independent quality assessment
- **QA Verification** - Functional validation against acceptance criteria
- **Evaluation** - Final assessment of completeness and quality

This methodology ensures that every task is thoroughly analyzed, properly planned, and rigorously validated before completion.

## Headless Harness Design

The `headless-harness-design` command is the **core execution engine** of projmnt4claude, implementing the **Harness Design** pattern inspired by Anthropic's research on AI-assisted software development.

### The 4-Stage Pipeline

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│ Development │ → │ Code Review │ → │ QA Verification│ → │ Evaluation  │
│  (Developer)│    │  (Reviewer) │    │   (Tester)   │    │ (Architect) │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
      │                   │                   │                   │
   Implement          Inspect             Validate           Assess
   Solution           Quality             Functionality      Completeness
```

**Stage 1: Development**
- Specialized agent (executor) implements the solution
- Follows acceptance criteria defined in the task
- Generates code changes and development report

**Stage 2: Code Review**
- Independent agent (reviewer) assesses code quality
- Checks against coding standards and best practices
- Identifies potential issues and improvement areas

**Stage 3: QA Verification**
- Tester agent validates functional requirements
- Runs automated tests and manual verification
- Ensures acceptance criteria are met

**Stage 4: Evaluation**
- Architect agent makes final assessment
- Determines PASS, NOPASS, or NEEDS_REEVALUATION
- Authorizes task completion or requests revision

### Key Features

- **Context Isolation** - Each stage runs in an independent Claude session
- **Sprint Contract** - Pre-defined acceptance criteria prevent subjective judgment
- **Auto-Retry** - Failed tasks automatically retry (configurable)
- **Evidence Collection** - Automatic collection of execution artifacts
- **Batch Processing** - Execute multiple tasks in organized batches
- **Git Integration** - Automatic commits per batch with detailed messages

## Quick Start Guide

The following examples use **Claude Code CLI** commands (recommended). For advanced usage with direct Node.js execution, see the [Advanced Usage](#advanced-usage) section.

### 0. Initialize Project

Set up projmnt4claude in your project:

```bash
/projmnt4claude:setup
```

This creates a `.projmnt4claude/` directory with the project structure.

### 1. Create Tasks from Requirements

Transform a problem description or requirement document into structured tasks:

```bash
# From natural language description
/projmnt4claude:init-requirement "Fix the memory leak in the authentication module that occurs under high concurrency"

# From a requirement file
/projmnt4claude:init-requirement --file ./requirements.md

# Non-interactive mode with auto-accept
/projmnt4claude:init-requirement --yes "Implement user authentication API with JWT support"
```

**Features:**
- Auto-extracts keywords and analyzes complexity
- Suggests priority (P0-P3) and recommended role
- Generates checkpoints with verification methods
- Optionally auto-splits complex tasks into subtasks

### 2. Recommend Execution Plan

Intelligently organize tasks into an optimized execution plan:

```bash
# Smart recommendation based on priority and dependencies
/projmnt4claude:plan recommend

# With query filter (supports keywords and regex)
/projmnt4claude:plan recommend --query "bug|fix|auth"
/projmnt4claude:plan recommend --query "^TASK-refactor-.*"

# Include all non-terminal tasks
/projmnt4claude:plan recommend --all

# Enable AI-powered semantic dependency detection
/projmnt4claude:plan recommend --smart
```

**Smart Grouping:**
- Groups tasks into **chains** based on dependencies
- Organizes chains into **batches** by priority
- Detects parallelizable tasks within same priority
- Three-layer dependency inference:
  - Layer 1/2: File path overlap detection
  - Layer 3: AI semantic analysis (with --smart)

### 3. Execute with Headless Harness

Run the complete 4-stage pipeline on your plan:

```bash
# Execute current plan
/projmnt4claude:headless-harness-design

# With batch auto-commit
/projmnt4claude:headless-harness-design --batch-git-commit

# Continue from interruption
/projmnt4claude:headless-harness-design --continue

# Dry run to preview
/projmnt4claude:headless-harness-design --dry-run
```

**Execution Flow:**
1. Loads tasks from `current-plan.json`
2. Processes each task through Development → Code Review → QA → Evaluation
3. Auto-retries failed tasks (up to max-retries)
4. Generates reports in `.projmnt4claude/reports/harness/`
5. Optionally commits changes per batch

### 4. Analyze Project Health

Get insights and recommendations for your project:

```bash
# Comprehensive analysis
/projmnt4claude:analyze

# With AI-powered insights
/projmnt4claude:analyze --deep

# Export training data for LLM fine-tuning
/projmnt4claude:analyze --export-training-data

# Fix detected issues automatically
/projmnt4claude:analyze --fix
```

**Analysis Includes:**
- Task status distribution
- Dependency health check
- Checkpoint completion tracking
- Bottleneck identification
- Recommendations for improvement

### 5. System Diagnostics

Check project integrity and generate reports:

```bash
# Full system check
/projmnt4claude:doctor

# Generate bug report
/projmnt4claude:doctor --bug-report

# Fix common issues
/projmnt4claude:doctor --fix
```

**Checks Include:**
- Project initialization status
- Task schema validation
- Orphaned task detection
- Hook availability verification
- Plan synchronization validation

## Advanced Usage

For users who prefer direct Node.js execution or want to customize the plugin behavior:

### Direct Node.js Execution

You can also run the CLI directly using Node.js:

```bash
# Setup
node $PLUGIN_DIR/skills/projmnt4claude/dist/projmnt4claude.js setup

# Create task from requirement
node $PLUGIN_DIR/skills/projmnt4claude/dist/projmnt4claude.js init-requirement "Your requirement description"

# Execute harness pipeline
node $PLUGIN_DIR/skills/projmnt4claude/dist/projmnt4claude.js headless-harness-design
```

### Advanced Mode

For users who want fine-grained control over task and plan management:

### Task Management Commands

Direct manipulation of tasks without the harness pipeline:

```bash
# Create task manually
projmnt4claude task create --title "Fix login bug" --priority P1 --type bugfix

# List tasks with filters
projmnt4claude task list --status open --priority P0,P1
projmnt4claude task list --type feature --role executor

# Show task details
projmnt4claude task show TASK-001

# Update task properties
projmnt4claude task update TASK-001 --status in_progress --priority P0

# Delete task
projmnt4claude task delete TASK-001

# Manage subtasks
projmnt4claude task add-subtask TASK-001 "Implement OAuth flow"
projmnt4claude task split TASK-001 --parts 3

# Manage dependencies
projmnt4claude task dependency add --from TASK-001 --to TASK-002
projmnt4claude task dependency remove --from TASK-001 --to TASK-002
```

### Plan Management Commands

Manual plan creation and adjustment:

```bash
# View current plan
projmnt4claude plan show

# Manually add/remove tasks
projmnt4claude plan add TASK-001
projmnt4claude plan add TASK-002 --after TASK-001
projmnt4claude plan remove TASK-001

# Clear plan
projmnt4claude plan clear

# Smart recommendation with options
projmnt4claude plan recommend --query "security" --all --smart
```

### Configuration Commands

Customize system behavior:

```bash
# View current configuration
projmnt4claude config list

# Update configuration
projmnt4claude config set ai.model claude-sonnet-4-6
projmnt4claude config set harness.maxRetries 5
projmnt4claude config set harness.timeout 1800

# Reset to defaults
projmnt4claude config reset
```

**Configurable Areas:**
- AI model selection for different roles
- Harness pipeline timeouts and retry limits
- Quality gate thresholds
- Prompt templates for headless agents
- Default task templates

## Installation

### From Marketplace (Recommended)

```bash
# Add marketplace
/plugin marketplace add fuzhibo/projmnt4claude

# Install with user scope (works across all projects)
/plugin install projmnt4claude --scope user
```

### Local Development

```bash
# Clone repository
git clone https://github.com/fuzhibo/projmnt4claude.git
cd projmnt4claude

# Install dependencies
bun install

# Build CLI
bun run build

# Install in Claude Code
/plugin install /path/to/projmnt4claude --scope user
```

## Project Structure

```
your-project/
└── .projmnt4claude/
    ├── config.json              # Project configuration
    ├── current-plan.json        # Active execution plan
    ├── harness-status.json      # Pipeline execution state
    ├── tasks/                   # Task directory
    │   └── TASK-001/
    │       ├── meta.json        # Task metadata
    │       └── checkpoints.md   # Checkpoint documentation
    ├── archive/                 # Archived tasks
    ├── reports/                 # Analysis & execution reports
    │   └── harness/             # Harness execution reports
    └── hooks/                   # Hook scripts
```

## Task Metadata Structure

```typescript
interface TaskMeta {
  id: string;                    // Task ID (e.g., TASK-001)
  title: string;                 // Task title
  description: string;           // Problem analysis + solution design
  type: 'feature' | 'bugfix' | 'refactor' | 'docs' | 'research';
  priority: 'P0' | 'P1' | 'P2' | 'P3' | 'Q1' | 'Q2' | 'Q3' | 'Q4';
  status: 'open' | 'in_progress' | 'wait_review' | 'wait_qa' | 'wait_evaluation' | 'resolved' | 'failed' | 'abandoned';
  role: 'executor' | 'researcher' | 'writer';
  dependencies: string[];        // Task IDs this task depends on
  checkpoints: Checkpoint[];     // Development → Review → QA → Evaluation
  acceptanceCriteria: string[];  // Sprint contract for completion
  createdAt: string;
  updatedAt: string;
}

interface Checkpoint {
  id: string;
  description: string;
  status: 'pending' | 'completed' | 'failed';
  requiresHuman: boolean;
  verification?: {
    method: 'automated' | 'manual' | 'script';
    result?: 'passed' | 'failed';
  };
}
```

## Development

```bash
# Install dependencies
bun install

# Run in dev mode
bun run src/index.ts --help

# Build
bun run build

# Type check
bunx tsc --noEmit

# Run tests
bun test
```

## Tech Stack

- **TypeScript** - Type-safe development
- **Bun** - Fast JavaScript runtime
- **Commander.js** - CLI framework
- **prompts** - Interactive CLI prompts
- **Claude Code** - AI-powered execution engine

## License

GNU Affero General Public License v3.0 (AGPLv3)

---

# projmnt4claude - Claude Code项目管理技能

**中文** | [English](#projmnt4claude---claude-code-project-management-skill)

专为 Claude Code 设计的项目管理技能，实现以**任务为中心的工作流**，具备完整的**开发 → 代码审核 → QA验证 → 评估**闭环机制。

## 核心理念

**projmnt4claude** 围绕一个基本原则构建：**每个问题或需求都应该被转化为任务**。每个任务遵循严格的闭环流程：

- **调查与分析** - 深入理解问题，根因分析
- **方案设计** - 结构化的实现方法，清晰的执行计划
- **开发** - 由专业智能体执行代码实现
- **代码审核** - 独立的质量评估
- **QA验证** - 针对验收标准的功能验证
- **评估** - 对完整性和质量的最终评估

这种方法论确保每个任务在被标记为完成之前都经过充分分析、妥善规划和严格验证。

## Headless Harness Design

`headless-harness-design` 命令是 projmnt4claude 的**核心执行引擎**，实现了受 Anthropic AI 辅助软件开发研究启发的 **Harness Design** 模式。

### 四阶段流水线

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│    开发     │ →  │   代码审核  │ →  │   QA验证    │ →  │    评估     │
│  (开发者)   │    │  (审核员)   │    │   (测试员)  │    │  (架构师)   │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
      │                   │                   │                   │
    实现方案            检查质量             验证功能            评估完整性
```

**阶段 1：开发**
- 专业智能体（执行者）实现解决方案
- 遵循任务中定义的验收标准
- 生成代码变更和开发报告

**阶段 2：代码审核**
- 独立智能体（审核员）评估代码质量
- 对照编码标准和最佳实践进行检查
- 识别潜在问题和改进领域

**阶段 3：QA验证**
- 测试智能体验证功能需求
- 运行自动化测试和手动验证
- 确保验收标准得到满足

**阶段 4：评估**
- 架构智能体进行最终评估
- 判定通过（PASS）、不通过（NOPASS）或需重新评估（NEEDS_REEVALUATION）
- 授权任务完成或请求修改

### 关键特性

- **上下文隔离** - 每个阶段在独立的 Claude 会话中运行
- **Sprint合约** - 预定义的验收标准避免主观判断
- **自动重试** - 失败任务自动重试（可配置）
- **证据收集** - 自动收集执行产物
- **批处理** - 按组织好的批次执行多个任务
- **Git集成** - 每批次自动提交，附带详细提交信息

## 快速入门指南

以下示例使用 **Claude Code CLI** 命令（推荐）。如需使用 Node.js 直接执行的高级用法，请参考 [高级用法](#高级用法) 章节。

### 0. 初始化项目

在您的项目中设置 projmnt4claude：

```bash
/projmnt4claude:setup
```

这会创建 `.projmnt4claude/` 目录和项目结构。

### 1. 从需求创建任务

将问题描述或需求文档转化为结构化任务：

```bash
# 从自然语言描述
/projmnt4claude:init-requirement "修复高并发下认证模块的内存泄漏问题"

# 从需求文件
/projmnt4claude:init-requirement --file ./requirements.md

# 非交互模式，自动接受
/projmnt4claude:init-requirement --yes "实现带JWT支持的用户认证API"
```

**特性：**
- 自动提取关键词和分析复杂度
- 建议优先级（P0-P3）和推荐角色
- 生成带验证方法的检查点
- 可选地将复杂任务自动拆分为子任务

### 2. 推荐执行计划

智能地将任务组织成优化的执行计划：

```bash
# 基于优先级和依赖的智能推荐
/projmnt4claude:plan recommend

# 带查询过滤（支持关键词和正则）
/projmnt4claude:plan recommend --query "bug|fix|auth"
/projmnt4claude:plan recommend --query "^TASK-refactor-.*"

# 包含所有非终态任务
/projmnt4claude:plan recommend --all

# 启用AI驱动的语义依赖检测
/projmnt4claude:plan recommend --smart
```

**智能分组：**
- 根据依赖将任务分组为**任务链**
- 按优先级将任务链组织为**批次**
- 在同一优先级内检测可并行执行的任务
- 三层依赖推断：
  - 第1/2层：文件路径重叠检测
  - 第3层：AI语义分析（使用 --smart）

### 3. 使用 Headless Harness 执行

在您的计划上运行完整的四阶段流水线：

```bash
# 执行当前计划
/projmnt4claude:headless-harness-design

# 带批次自动提交
/projmnt4claude:headless-harness-design --batch-git-commit

# 从中断处继续
/projmnt4claude:headless-harness-design --continue

# 试运行预览
/projmnt4claude:headless-harness-design --dry-run
```

**执行流程：**
1. 从 `current-plan.json` 加载任务
2. 将每个任务处理通过 开发 → 代码审核 → QA → 评估
3. 失败任务自动重试（最多 max-retries 次）
4. 在 `.projmnt4claude/reports/harness/` 生成报告
5. 可选地每批次提交变更

### 4. 分析项目健康

获取项目的洞察和建议：

```bash
# 综合分析
/projmnt4claude:analyze

# 带AI深度洞察
/projmnt4claude:analyze --deep

# 导出LLM微调训练数据
/projmnt4claude:analyze --export-training-data

# 自动修复检测到的问题
/projmnt4claude:analyze --fix
```

**分析包括：**
- 任务状态分布
- 依赖健康检查
- 检查点完成跟踪
- 瓶颈识别
- 改进建议

### 5. 系统诊断

检查项目完整性并生成报告：

```bash
# 完整系统检查
/projmnt4claude:doctor

# 生成错误报告
/projmnt4claude:doctor --bug-report

# 修复常见问题
/projmnt4claude:doctor --fix
```

**检查包括：**
- 项目初始化状态
- 任务 schema 验证
- 孤儿任务检测
- Hook 可用性验证
- 计划同步验证

## 高级用法

对于偏好直接 Node.js 执行或希望自定义插件行为的用户：

### 直接 Node.js 执行

您也可以使用 Node.js 直接运行 CLI：

```bash
# 初始化
node $PLUGIN_DIR/skills/projmnt4claude/dist/projmnt4claude.js setup

# 从需求创建任务
node $PLUGIN_DIR/skills/projmnt4claude/dist/projmnt4claude.js init-requirement "您的需求描述"

# 执行 harness 流水线
node $PLUGIN_DIR/skills/projmnt4claude/dist/projmnt4claude.js headless-harness-design
```

## 高级模式

希望对任务和计划管理进行细粒度控制的用户：

### 任务管理命令

直接操作任务，不经过 harness 流水线：

```bash
# 手动创建任务
projmnt4claude task create --title "修复登录bug" --priority P1 --type bugfix

# 带过滤列出任务
projmnt4claude task list --status open --priority P0,P1
projmnt4claude task list --type feature --role executor

# 显示任务详情
projmnt4claude task show TASK-001

# 更新任务属性
projmnt4claude task update TASK-001 --status in_progress --priority P0

# 删除任务
projmnt4claude task delete TASK-001

# 管理子任务
projmnt4claude task add-subtask TASK-001 "实现OAuth流程"
projmnt4claude task split TASK-001 --parts 3

# 管理依赖
projmnt4claude task dependency add --from TASK-001 --to TASK-002
projmnt4claude task dependency remove --from TASK-001 --to TASK-002
```

### 计划管理命令

手动创建和调整计划：

```bash
# 查看当前计划
projmnt4claude plan show

# 手动添加/移除任务
projmnt4claude plan add TASK-001
projmnt4claude plan add TASK-002 --after TASK-001
projmnt4claude plan remove TASK-001

# 清空计划
projmnt4claude plan clear

# 带选项的智能推荐
projmnt4claude plan recommend --query "security" --all --smart
```

### 配置命令

自定义系统行为：

```bash
# 查看当前配置
projmnt4claude config list

# 更新配置
projmnt4claude config set ai.model claude-sonnet-4-6
projmnt4claude config set harness.maxRetries 5
projmnt4claude config set harness.timeout 1800

# 重置为默认
projmnt4claude config reset
```

**可配置项：**
- 不同角色的 AI 模型选择
- Harness 流水线超时和重试限制
- 质量门禁阈值
- 无头智能体的提示词模板
- 默认任务模板

## 安装

### 从 Marketplace 安装（推荐）

```bash
# 添加 marketplace
/plugin marketplace add fuzhibo/projmnt4claude

# 使用 user 范围安装（适用于所有项目）
/plugin install projmnt4claude --scope user
```

### 本地开发

```bash
# 克隆仓库
git clone https://github.com/fuzhibo/projmnt4claude.git
cd projmnt4claude

# 安装依赖
bun install

# 打包 CLI
bun run build

# 在 Claude Code 中安装
/plugin install /path/to/projmnt4claude --scope user
```

## 项目结构

```
your-project/
└── .projmnt4claude/
    ├── config.json              # 项目配置
    ├── current-plan.json        # 活动执行计划
    ├── harness-status.json      # 流水线执行状态
    ├── tasks/                   # 任务目录
    │   └── TASK-001/
    │       ├── meta.json        # 任务元数据
    │       └── checkpoints.md   # 检查点文档
    ├── archive/                 # 归档任务
    ├── reports/                 # 分析和执行报告
    │   └── harness/             # Harness 执行报告
    └── hooks/                   # 钩子脚本
```

## 任务元数据结构

```typescript
interface TaskMeta {
  id: string;                    // 任务 ID（如 TASK-001）
  title: string;                 // 任务标题
  description: string;           // 问题分析 + 方案设计
  type: 'feature' | 'bugfix' | 'refactor' | 'docs' | 'research';
  priority: 'P0' | 'P1' | 'P2' | 'P3' | 'Q1' | 'Q2' | 'Q3' | 'Q4';
  status: 'open' | 'in_progress' | 'wait_review' | 'wait_qa' | 'wait_evaluation' | 'resolved' | 'failed' | 'abandoned';
  role: 'executor' | 'researcher' | 'writer';
  dependencies: string[];        // 此任务依赖的任务ID
  checkpoints: Checkpoint[];     // 开发 → 审核 → QA → 评估
  acceptanceCriteria: string[];  // 完成的 Sprint 合约
  createdAt: string;
  updatedAt: string;
}

interface Checkpoint {
  id: string;
  description: string;
  status: 'pending' | 'completed' | 'failed';
  requiresHuman: boolean;
  verification?: {
    method: 'automated' | 'manual' | 'script';
    result?: 'passed' | 'failed';
  };
}
```

## 开发

```bash
# 安装依赖
bun install

# 开发模式运行
bun run src/index.ts --help

# 打包
bun run build

# 类型检查
bunx tsc --noEmit

# 运行测试
bun test
```

## 技术栈

- **TypeScript** - 类型安全开发
- **Bun** - 快速 JavaScript 运行时
- **Commander.js** - CLI 框架
- **prompts** - 交互式 CLI 提示
- **Claude Code** - AI 驱动的执行引擎

## 许可证

GNU Affero General Public License v3.0 (AGPLv3)
