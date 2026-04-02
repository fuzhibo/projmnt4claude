---
description: "管理项目任务 - 创建、查看、更新、执行任务"
argument-hint: "<action> [id] [options]"
---

# 任务管理命令

管理 Claude Code 项目任务。

## 执行方式

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js task <action> [options]
```

## 可用操作

| 操作 | 描述 | 示例 |
|------|------|------|
| `create` | 交互式创建新任务 | `task create` |
| `list` | 列出所有任务 | `task list --status in_progress` |
| `show` | 显示任务详情 | `task show TASK-001` |
| `update` | 更新任务属性 | `task update TASK-001 --status resolved` |
| `delete` | 删除（归档)任务 | `task delete TASK-001` |
| `rename` | 重命名任务 ID | `task rename TASK-001 TASK-feature-new-name` |
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
| `count` | 统计任务数量 | `task count -g status` |
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
- `--role <role>` - 更新推荐角色
- `--branch <branch>` - 更新关联分支
- `--token <token>` - 检查点确认令牌 (仅 update resolved)
- `--sync-children` - 同步子任务状态 (仅 update resolved/closed)
- `--no-sync` - 不同步子任务状态 (仅 update)

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
projmnt4claude task split TASK-001 --into 3
projmnt4claude task split TASK-001 --titles "前端实现,后端API,测试验证"
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
projmnt4claude task batch-update --status in_progress -y
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
projmnt4claude task count
projmnt4claude task count -g status
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
projmnt4claude task sync-children TASK-001
projmnt4claude task sync-children TASK-001 --status resolved
```

## discuss - 标记任务需要讨论

标记任务为需要讨论状态。此功能已集成到 `update` 命令的 `--needs-discussion` 选项中。

```bash
projmnt4claude task discuss <taskId> --topic <topic>
```

> **提示**: 推荐使用 `task update TASK-001 --needs-discussion` 来标记，使用 `--topic "主题"` 添加讨论主题。

## 检查点 (checkpoint)

完成检查点以推进任务进度。

```bash
# 完成检查点
projmnt4claude task checkpoint TASK-001

# 验证检查点
projmnt4claude task checkpoint TASK-001 verify
```

## 文件
/home/fuzhibo/workerplace/git/projmnt4claude/commands/task.md
