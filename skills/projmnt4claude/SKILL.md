---
name: projmnt4claude
description: Claude Code 项目管理技能。用于管理任务、执行计划、工具箱、Harness Design 执行、Git分支集成等。当用户提到"任务管理"、"项目管理"、"创建任务"、"执行计划"、"harness"时使用。
---

# projmnt4claude - Claude Code 项目管理技能

一个专为 Claude Code 设计的项目管理技能，帮助管理开发任务、执行计划、本地工具箱、Harness Design 执行和 Git 分支集成。

---

## ⚡ 命令速查表 (AI 快速参考)

> **重要**: 所有命令格式为 `projmnt4claude <命令> [子命令] [选项]`

| 命令 | 用途 | 示例 |
|------|------|------|
| `task list` | 列出任务 | `projmnt4claude task list --status open` |
| `task show <id>` | 查看任务 | `projmnt4claude task show TASK-001` |
| `task update <id>` | 更新任务 | `projmnt4claude task update TASK-001 --status resolved` |
| `task create` | 创建任务 | `projmnt4claude task create` |
| `status` | 项目状态 | `projmnt4claude status` |
| `analyze` | 项目分析 | `projmnt4claude analyze` |
| `init-requirement` | 需求转任务 | `projmnt4claude init-requirement -y "需求描述"` |
| `headless-harness-design` | Harness 执行 | `projmnt4claude headless-harness-design --plan plan.json` |

### ⚠️ 常见错误

```
❌ projmnt4claude list              # 缺少 task 子命令
❌ projmnt4claude --status open     # 缺少 task list
❌ projmnt4claude show TASK-001     # 缺少 task 子命令

✅ projmnt4claude task list --status open
✅ projmnt4claude task show TASK-001
```

---

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

### 项目分析

| 命令 | 描述 |
|------|------|
| `status` | 显示项目状态摘要 |
| `analyze [--fix]` | 分析项目健康状态 |

### 全局选项

| 选项 | 描述 |
|------|------|
| `--ai` | AI 模式: 自动启用 --json 输出 + 非交互模式 + 精简日志 |
| `--json` | JSON 格式输出 (全局，适用于所有命令) |

### 帮助系统

| 命令 | 描述 |
|------|------|
| `help [command|topic]` | 显示命令使用说明和帮助信息 |

### 自然语言需求

| 命令 | 描述 |
|------|------|
| `init-requirement "<description>"` | 从自然语言描述创建任务 |
| `init-requirement -y --file <path>` | 从文件读取描述创建任务（推荐用于复杂描述） |

> ⚠️ **AI调用限制**: 当描述包含代码块（特别是包含 `{}` 或 `$()` 的代码）时，**必须**使用 `--file` 选项，否则会导致Bash解析错误。详见下方的 [AI调用限制说明](#ai调用限制说明)。

### Harness Design 执行

| 命令 | 描述 |
|------|------|
| `headless-harness-design --plan <file>` | 使用 Harness Design 模式执行任务计划 |

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
| `wait_review` | 待审查 |
| `wait_qa` | 待测试 |
| `wait_complete` | 待完成 |
| `resolved` | 已解决 |
| `closed` | 已关闭 |
| `abandoned` | 已放弃 |

> **已废弃状态**: `reopened` 已废弃，使用 `task update <id> --status reopened` 会自动映射为 `open` + `reopenCount` 递增 + `transitionNote` 记录。

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

---

## AI调用限制说明

> **重要**: 本节详细说明AI在调用 `projmnt4claude` 命令时的限制和边界，**必须仔细阅读**以避免调用错误。

### 1. 特殊字符限制（关键）

#### ❌ 不能直接在命令行传递包含以下内容的描述

| 问题字符/模式 | 示例 | 原因 |
|-------------|------|------|
| **花括号 `{}`** | `if (condition) { ... }` | Bash解释为复合命令语法 |
| **命令替换 `$()`** | `$(command)` | Bash执行命令替换 |
| **反引号** | `` `command` `` | Bash执行命令替换 |
| **变量扩展 `${}`** | `${variable}` | Bash解释为变量扩展 |
| **管道符 `\|`** | `command1 \| command2` | Bash解释为管道操作 |
| **分号 `;`** | `cmd1 ; cmd2` | Bash解释为命令分隔符 |
| **重定向 `< >`** | `echo > file` | Bash解释为IO重定向 |
| **与号 `&`** | `command &` | Bash解释为后台执行 |
| **美元符 `$`** | `$variable` | Bash解释为变量引用 |

#### ✅ 解决方案：使用 `--file` 选项

当描述包含上述任何特殊字符时，**必须使用 `--file` 选项**：

```bash
# Step 1: 将描述写入临时文件
cat > /tmp/task-desc.md << 'EOF'
## 修复 blocked 统计逻辑

当前代码问题：
```typescript
if (uncompletedDeps.length > 0 && 
    normalizedStatus !== 'resolved' && 
    normalizedStatus !== 'closed') {
  stats.blocked++;
}
```

需要添加对 `abandoned` 状态的排除。
EOF

# Step 2: 使用 --file 选项调用
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js init-requirement -y --file /tmp/task-desc.md

# Step 3: 清理临时文件
rm /tmp/task-desc.md
```

### 2. 命令行参数长度限制

| 限制类型 | 限制值 | 说明 |
|---------|-------|------|
| 单个参数长度 | 约 128KB-2MB（系统相关） | 超长描述会截断或失败 |
| 总命令行长度 | 约 2MB（Linux） | 超过会报错 "Argument list too long" |

**建议**: 超过 1000 字符的描述，使用 `--file` 选项。

### 3. 命令调用方式限制

#### ✅ 正确的调用方式

```bash
# 1. 简单描述（无特殊字符）
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js init-requirement -y "实现用户登录功能"

# 2. 复杂描述（使用 --file）
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js init-requirement -y --file /tmp/desc.md

# 3. 非交互模式（AI推荐）
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js init-requirement -y --no-plan --file /tmp/desc.md
```

#### ❌ 错误的调用方式

```bash
# 错误1: 包含代码块的直接传递
node projmnt4claude.js init-requirement -y "修复 { if (x) { return; } }"

# 错误2: 包含变量扩展
node projmnt4claude.js init-requirement -y "使用 ${variable} 配置"

# 错误3: 包含命令替换
node projmnt4claude.js init-requirement -y "输出 $(command) 的结果"
```

### 4. 文件路径限制

| 限制 | 说明 | 解决方案 |
|------|------|---------|
| 相对路径 | 相对于当前工作目录 | 使用 `$(pwd)/relative/path` |
| 空格路径 | 路径包含空格 | 使用 `--file` 时无需转义，直接写路径 |
| 不存在路径 | `--file` 指定不存在的文件 | 命令会报错并退出 |
| 目录路径 | `--file` 指定目录而非文件 | 命令会报错并退出 |

### 5. 多行描述处理

当需要传递多行描述时：

```bash
# ✅ 推荐：使用 --file 选项
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js init-requirement -y --file ./description.md

# ⚠️ 不推荐：命令行换行（容易出错）
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js init-requirement -y "第一行
第二行
第三行"
```

### 6. 快速决策流程图

```
开始创建任务
    │
    ▼
描述是否包含代码块？
    │
    ├── 是 ──→ 使用 --file 选项
    │              │
    │              ▼
    │          写入临时文件
    │              │
    │              ▼
    │          调用命令
    │              │
    │              ▼
    │          清理临时文件
    │
    └── 否 ──→ 描述是否 > 1000字符？
                   │
                   ├── 是 ──→ 使用 --file 选项
                   │
                   └── 否 ──→ 直接传递参数
```

### 7. 常见错误及解决方案

| 错误信息 | 原因 | 解决方案 |
|---------|------|---------|
| `syntax error near unexpected token '{'` | 描述包含 `{}` | 使用 `--file` 选项 |
| `command substitution: line X: ...` | 描述包含 `$()` 或 `` ` `` | 使用 `--file` 选项 |
| `bad substitution` | 描述包含 `${}` | 使用 `--file` 选项 |
| `Argument list too long` | 描述过长 | 使用 `--file` 选项 |
| `错误: 描述文件不存在` | `--file` 路径错误 | 检查文件路径 |
| `错误: 指定路径不是文件` | `--file` 指向目录 | 检查路径是否为文件 |

### 8. 最佳实践

1. **始终使用 `--file` 选项处理复杂描述**
   - 任何包含代码、JSON、XML的描述都应使用 `--file`

2. **使用临时文件**
   - 将临时文件放在 `/tmp/` 目录
   - 命名格式: `task-desc-$$.md`（$$会被替换为PID）

3. **及时清理**
   - 命令执行后立即删除临时文件
   - 或使用 `--no-plan` 避免交互阻塞

4. **验证文件存在**
   - 在调用前检查文件是否成功创建

5. **使用 `<< 'EOF'` 语法**
   - 单引号包裹的 `EOF` 不会进行变量扩展
   - 确保内容原样写入文件

### 9. 示例：完整的AI任务创建流程

```bash
#!/bin/bash
# AI任务创建脚本示例

# 1. 准备任务描述
TASK_DESC=$(cat << 'ENDOFDESC'
## 任务标题：修复性能瓶颈

### 问题描述
当前接口响应时间过长：

```typescript
// 问题代码
async function getData() {
  const data = await db.query("SELECT * FROM large_table");
  return data.map(item => process(item));
}
```

### 优化方案
1. 添加分页查询
2. 使用 Redis 缓存
3. 异步处理大数据

### 验收标准
- [ ] 接口响应时间 < 200ms
- [ ] 支持分页参数
- [ ] 添加缓存机制
ENDOFDESC
)

# 2. 写入临时文件
TEMP_FILE="/tmp/task-desc-$$.md"
echo "$TASK_DESC" > "$TEMP_FILE"

# 3. 验证文件
if [ ! -f "$TEMP_FILE" ]; then
  echo "错误: 无法创建临时文件"
  exit 1
fi

# 4. 创建任务
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js init-requirement \
  -y \
  --no-plan \
  --file "$TEMP_FILE"

# 5. 清理
rm -f "$TEMP_FILE"

echo "任务创建完成"
```
