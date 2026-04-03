---
description: "管理项目任务 - 创建、查看、更新、执行任务"
argument-hint: "<action> [id] [options]"
---

# 任务管理命令

管理 Claude Code 项目任务。

## 执行方式

```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js task <action> [options]
```

## 🎯 AI 行为指南

### 直接输出模式（无需 AI 处理）
当用户**仅**调用命令，没有额外提示词时，**直接输出脚本结果**，AI 无需处理：

```
用户: projmnt4claude task list
AI: [直接输出命令结果，无需额外解释]

用户: projmnt4claude task show TASK-001
AI: [直接输出命令结果，无需额外解释]

用户: projmnt4claude status
AI: [直接输出命令结果，无需额外解释]
```

### AI 处理模式（需要进一步分析）
当用户调用命令**后跟了额外提示词**，AI 才介入处理：

```
用户: projmnt4claude task list，帮我找出优先级最高的任务
AI: [分析结果，找出 P0 任务]

用户: projmnt4claude status，项目健康吗？
AI: [分析健康分数，给出建议]

用户: projmnt4claude task show TASK-001，这个任务还需要做什么？
AI: [分析检查点，回答未完成项]
```

### AI 内部调用（精简模式）
AI 自主调用命令时，使用 `--json` 或 `--compact` 减少上下文：

```bash
# AI 获取结构化数据
projmnt4claude task show TASK-001 --json
projmnt4claude task list --json --fields id,title,status
```

## 使用场景

### 用户直接运行（人类友好模式）
默认输出格式适合人类阅读，包含视觉装饰和格式化信息：
```bash
# 用户查看任务详情
projmnt4claude task show TASK-001

# 用户列出任务
projmnt4claude task list --status open
```

### AI 调用（精简模式）
AI 调用时应使用 `--json` 或 `--compact` 选项，减少上下文消耗：
```bash
# AI 获取任务详情 - JSON 格式
projmnt4claude task show TASK-001 --json

# AI 快速查看任务 - 精简格式
projmnt4claude task show TASK-001 --compact

# AI 列出任务 - JSON 格式
projmnt4claude task list --json --fields id,title,status,priority

# AI 获取完整任务信息
projmnt4claude task show TASK-001 --verbose --json
```

## 可用操作

| 操作 | 描述 | 示例 |
|------|------|------|
| `create` | 交互式创建新任务 | `task create` |
| `list` | 列出所有任务 | `task list --status in_progress` |
| `show` | 显示任务详情 | `task show TASK-001` |
| `update` | 更新任务属性 | `task update TASK-001 --status resolved` |
| `delete` | 删除（归档)任务 | `task delete TASK-001` |
| `rename` | 重命名任务 ID | `task rename TASK-001 TASK-feature-new` |
| `purge` | 清除已归档的 abandoned 任务 | `task purge -y` |
| `execute` | 引导执行任务 | `task execute TASK-001` |
| `checkpoint` | 完成检查点 | `task checkpoint TASK-001` |
| `dependency` | 管理依赖 | `task dependency add TASK-001 --dep-id TASK-002` |
| `add-subtask` | 为父任务创建子任务 | `task add-subtask TASK-001 "实现登录功能"` |
| `split` | 拆分任务为多个子任务 | `task split TASK-001 --into 3` |
| `search` | 搜索任务 | `task search "登录"` |
| `batch-update` | 批量更新任务 | `task batch-update --status in_progress` |
| `submit` | 提交任务等待验证 | `task submit TASK-001` |
| `validate` | 验证已提交的任务 | `task validate TASK-001` |
| `history` | 查看任务变更历史 | `task history TASK-001` |
| `status-guide` | 显示状态转换指南 | `task status-guide` |
| `complete` | 一键完成任务 | `task complete TASK-001` |
| `count` | 统计任务数量 | `task count --group-by status` |
| `sync-children` | 同步子任务状态 | `task sync-children TASK-001` |
| `discuss` | 标记任务需要讨论 | `task discuss TASK-001 --topic "方案选择"` |
| `help` | 显示帮助 | `task help` |

## 过滤选项 (list)
- `--status <status>` - 按状态过滤
- `--priority <priority>` - 按优先级过滤
- `--role <role>` - 按推荐角色过滤
- `--fields <fields>` - 自定义输出字段 (逗号分隔) **[AI 推荐]**
- `--json` - JSON 格式输出 **[AI 推荐]**
- `--missing-verification` - 筛选缺少验证的任务
- `-g, --group <field>` - 分组显示: status/priority/type/role

## 显示选项 (show)
- `-v, --verbose` - 显示完整信息 (包含历史、依赖、验证信息)
- `--history` - 仅显示变更历史
- `--json` - JSON 格式输出 **[AI 推荐]**
- `--compact` - 精简输出 (无装饰字符) **[AI 推荐]**
- `--checkpoints` - 显示检查点详情（包含验证结果）

## 更新选项 (update)
- `--title <title>` - 更新标题
- `--description <desc>` - 更新描述
- `--status <status>` - 更新状态
- `--priority <priority>` - 更新优先级


## rename - 重命名任务

重命名任务 ID，自动更新其他任务中的引用关系（依赖、父子关系等）。

```bash
projmnt4claude task rename <oldTaskId> <newTaskId>
```

**示例:**
```bash
projmnt4claude task rename TASK-001 TASK-feature-new-name
```

## purge - 清除已归档任务

物理删除归档目录中状态为 `abandoned` 的任务（不可恢复）。

```bash
projmnt4claude task purge [-y]
```

**选项:**
- `-y, --yes` - 非交互模式，直接执行删除
- `--json` - JSON 格式输出

**示例:**
```bash
# 预览将被清除的任务
projmnt4claude task purge

# 确认清除
projmnt4claude task purge -y
```

## split - 拆分任务

将任务拆分为多个子任务，支持按数量或自定义标题拆分。自动创建链式依赖。

```bash
projmnt4claude task split <taskId> [--into <count>] [--titles <titles>] [-y]
```

**选项:**
- `--into <count>` - 拆分数量（自动生成标题）
- `--titles <titles>` - 子任务标题列表（逗号分隔）
- `-y, --yes` - 非交互模式

**示例:**
```bash
# 按数量拆分为 3 个子任务
projmnt4claude task split TASK-001 --into 3

# 指定标题拆分
projmnt4claude task split TASK-001 --titles "前端实现,后端API,测试验证"

# 非交互模式
projmnt4claude task split TASK-001 --into 2 -y
```

## search - 搜索任务

按关键词搜索任务，匹配 ID、标题和描述。

```bash
projmnt4claude task search <keyword> [--status <status>] [--priority <priority>] [--json]
```

**选项:**
- `--status <status>` - 按状态过滤
- `--priority <priority>` - 按优先级过滤
- `--json` - JSON 格式输出

**示例:**
```bash
projmnt4claude task search "登录"
projmnt4claude task search "API" --status open --json
```

## batch-update - 批量更新任务

批量更新多个任务的状态或优先级。

```bash
projmnt4claude task batch-update --status <status> [--priority <priority>] [--all] [-y]
```

**选项:**
- `--status <status>` - 新状态（必填之一）
- `--priority <priority>` - 新优先级（必填之一）
- `--all` - 包含已完成/已关闭的任务
- `-y, --yes` - 非交互模式

**示例:**
```bash
# 批量设置所有未完成任务为 in_progress
projmnt4claude task batch-update --status in_progress -y

# 批量调整优先级（不含已完成任务）
projmnt4claude task batch-update --priority P1 -y
```

## submit - 提交任务等待验证

将任务状态从 `in_progress`/`open` 更新为 `wait_complete`，等待质量门禁验证。

```bash
projmnt4claude task submit <taskId> [--note <note>]
```

**选项:**
- `--note <note>` - 提交备注

**示例:**
```bash
projmnt4claude task submit TASK-001
projmnt4claude task submit TASK-001 --note "所有检查点已完成"
```

## validate - 验证任务

对 `wait_complete` 状态的任务执行验证，通过后自动更新为 `resolved`，失败则返回 `in_progress`。

```bash
projmnt4claude task validate <taskId>
```

**示例:**
```bash
projmnt4claude task validate TASK-001
```

## history - 查看变更历史

查看任务的完整变更历史记录，包含状态流转、字段变更、原因等。

```bash
projmnt4claude task history <taskId>
```

**示例:**
```bash
projmnt4claude task history TASK-001
```

## status-guide - 状态转换指南

显示任务状态说明和转换矩阵，帮助理解合法的状态流转路径。

```bash
projmnt4claude task status-guide
```

**示例:**
```bash
projmnt4claude task status-guide
```

## complete - 一键完成任务

自动执行：验证检查点 → 更新状态为 `resolved`。未完成的检查点会提示是否自动标记完成。

```bash
projmnt4claude task complete <taskId> [-y]
```

**选项:**
- `-y, --yes` - 非交互模式，自动标记检查点并完成

**示例:**
```bash
projmnt4claude task complete TASK-001
projmnt4claude task complete TASK-001 -y
```

## count - 统计任务数量

统计任务数量，支持按状态、优先级、类型分组。

```bash
projmnt4claude task count [--status <status>] [--priority <priority>] [--type <type>] [-g <field>] [--json]
```

**选项:**
- `--status <status>` - 按状态过滤
- `--priority <priority>` - 按优先级过滤
- `--type <type>` - 按类型过滤（bug/feature/research/docs/refactor/test）
- `-g, --group <field>` - 分组统计：status/priority/type/role
- `--json` - JSON 格式输出

**示例:**
```bash
# 总体统计
projmnt4claude task count

# 按状态分组
projmnt4claude task count -g status

# JSON 格式输出
projmnt4claude task count --json
```

## sync-children - 同步子任务状态

将父任务的状态同步到所有子任务。已关闭/已放弃的子任务会被跳过。

```bash
projmnt4claude task sync-children <parentTaskId> [--status <status>]
```

**选项:**
- `--status <status>` - 指定目标状态（默认使用父任务当前状态）

**示例:**
```bash
# 同步父任务状态到子任务
projmnt4claude task sync-children TASK-001

# 指定目标状态
projmnt4claude task sync-children TASK-001 --status resolved
```

## discuss - 标记任务需要讨论

标记任务为需要讨论状态。此功能已集成到 `update` 命令的 `--needs-discussion` 选项中。

```bash
projmnt4claude task discuss <taskId> --topic <topic>
```

> **提示**: 推荐使用 `task update TASK-001 --needs-discussion` 来标记，使用 `--topic "主题"` 添加讨论主题。

## 更多示例

```bash
# 创建子任务
projmnt4claude task add-subtask TASK-001 "实现用户登录功能"

# 查看子任务
projmnt4claude task show TASK-001-1

# 更新子任务状态
projmnt4claude task update TASK-001-1 --status in_progress

# 显示完整任务信息
projmnt4claude task show TASK-001 --verbose

# JSON 格式输出
projmnt4claude task show TASK-001 --json

# 自定义字段输出
projmnt4claude task list --fields id,title,status

# 筛选缺少验证的任务
projmnt4claude task list --missing-verification

# 重命名任务
projmnt4claude task rename TASK-001 TASK-feature-new-name

# 拆分任务
projmnt4claude task split TASK-001 --into 3

# 搜索任务
projmnt4claude task search "登录"

# 统计任务
projmnt4claude task count -g status

# 一键完成
projmnt4claude task complete TASK-001 -y
```

## 检查点 (checkpoint)

检查点用于跟踪任务的完成进度。支持交互式确认和细粒度操作。

### 检查点子命令

| 子命令 | 描述 | 示例 |
|--------|------|------|
| `list` | 列出所有检查点 | `task checkpoint TASK-001 list` |
| `complete` | 标记检查点完成 | `task checkpoint TASK-001 CP-001 complete --result "验证通过"` |
| `fail` | 标记检查点失败 | `task checkpoint TASK-001 CP-001 fail --note "需要调查"` |
| `note` | 更新检查点备注 | `task checkpoint TASK-001 CP-001 note --note "等待确认"` |
| `show` | 显示检查点详情 | `task checkpoint TASK-001 CP-001 show` |
| `verify` | 验证检查点并生成令牌 | `task checkpoint TASK-001 verify` |
| (默认) | 交互式确认所有检查点 | `task checkpoint TASK-001` |

### 检查点选项

| 选项 | 描述 | 适用子命令 |
|------|------|------------|
| `--result <text>` | 验证结果 | `complete` |
| `--note <text>` | 检查点备注 | `complete`, `fail`, `note` |
| `--json` | JSON 格式输出 | `list` |
| `--compact` | 精简输出 | `list` |
| `-y, --yes` | 非交互模式 | (默认) |

### 示例

```bash
# 列出所有检查点
projmnt4claude task checkpoint TASK-001 list

# 列出检查点 (JSON 格式)
projmnt4claude task checkpoint TASK-001 list --json

# 标记检查点完成并添加验证结果
projmnt4claude task checkpoint TASK-001 CP-001 complete --result "截图确认：显示 Connection lost 错误"

# 标记检查点失败
projmnt4claude task checkpoint TASK-001 CP-001 fail --note "需要进一步调查"

# 更新检查点备注
projmnt4claude task checkpoint TASK-001 CP-001 note --note "等待用户确认"

# 显示检查点详情
projmnt4claude task checkpoint TASK-001 CP-001 show

# 交互式确认所有检查点（原有功能）
projmnt4claude task checkpoint TASK-001

# 验证检查点并生成令牌
projmnt4claude task checkpoint TASK-001 verify
```

### 检查点数据存储

检查点数据存储在两个位置：
- **checkpoint.md** - 检查点列表和完成状态（人类可读）
- **meta.json** - 检查点元数据（ID、验证结果、备注等）

首次访问时自动同步，无需手动操作。

## ⚠️ 任务完成验证流程 (重要)

**在将任务标记为 resolved/closed 之前，必须完成以下验证步骤：**

### 为什么需要验证？

任务完成验证确保：
1. 所有检查点都已完成并验证
2. 任务产出物符合预期
3. 避免遗漏重要工作项
4. 保持项目质量一致性

### 验证流程

```
┌─────────────────────────────────────────────────────────────┐
│                  任务完成验证流程                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 完成所有检查点                                           │
│     └─ 编辑 checkpoint.md，将 [ ] 改为 [x]                   │
│                                                             │
│  2. 验证检查点                                               │
│     └─ projmnt4claude task checkpoint verify <taskId>        │
│     └─ 获取验证令牌 (token)                                  │
│                                                             │
│  3. 使用令牌完成任务                                         │
│     └─ projmnt4claude task update <taskId> --status resolved │
│        --token <token>                                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 没有检查点的任务

如果任务没有 checkpoint.md 文件或检查点为空，可以直接更新状态：
```bash
projmnt4claude task update TASK-001 --status resolved
```

### 有检查点的任务

**步骤 1: 确认所有检查点已完成**
```bash
# 查看检查点状态
projmnt4claude task show TASK-001

# 或直接查看 checkpoint.md 文件
cat .projmnt4claude/tasks/TASK-001/checkpoint.md
```

**步骤 2: 验证检查点并获取令牌**
```bash
projmnt4claude task checkpoint verify TASK-001
```

**步骤 3: 使用令牌完成任务**
```bash
projmnt4claude task update TASK-001 --status resolved --token CP-XXXXXXX-XXXXXXXX
```

### ⚠️ AI 注意事项

**禁止行为**：
- ❌ 跳过检查点验证直接标记任务为 resolved
- ❌ 忽略未完成的检查点
- ❌ 伪造验证令牌

**正确行为**：
- ✅ 完成所有检查点后再验证
- ✅ 获取有效的验证令牌
- ✅ 使用令牌完成任务更新

## 文件
/home/fuzhibo/workerplace/git/projmnt4claude/commands/task.md
