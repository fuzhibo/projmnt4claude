---
description: "Git 分支集成 (checkout/status/create/delete/merge/push/sync)"
argument-hint: "<action> [id] [-b <branchName>] [-m <message>]"
---

# Git 分支集成

管理任务与 Git 分支的集成，支持分支的创建、切换、合并等操作。

## 执行方式

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js branch <action> [id] [options]
```

## 选项

| 选项 | 描述 |
|------|------|
| `-b, --branch-name <branchName>` | 分支名称（仅 create 操作） |
| `-m, --message <message>` | 合并消息（仅 merge 操作） |

## 操作说明

### checkout - 切换到任务分支

切换到指定任务关联的 Git 分支。

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js branch checkout <id>
```

**参数:**
- `id` (必填) - 任务ID

### status - 查看分支状态

显示当前分支与任务关联的状态信息。

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js branch status
```

### create - 创建任务分支

为指定任务创建关联的 Git 分支。

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js branch create <id>
```

自定义分支名称：

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js branch create <id> --branch-name feature/my-branch
```

**参数:**
- `id` (必填) - 任务ID
- `--branch-name <name>` (可选) - 自定义分支名称

### delete - 删除任务分支

删除指定任务关联的 Git 分支。

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js branch delete <id>
```

**参数:**
- `id` (必填) - 任务ID

### merge - 合并任务分支

将指定任务的分支合并到当前分支。

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js branch merge <id>
```

指定合并消息：

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js branch merge <id> --message "合并任务完成"
```

**参数:**
- `id` (必填) - 任务ID
- `--message <msg>` (可选) - 合并提交消息

### push - 推送任务分支

将指定任务的分支推送到远程仓库。

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js branch push <id>
```

**参数:**
- `id` (必填) - 任务ID

### sync - 同步分支

同步分支信息，保持本地与远程分支状态一致。

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js branch sync [id]
```

**参数:**
- `id` (可选) - 任务ID（不指定则同步所有分支）

## 支持的操作

| 操作 | 描述 | 必填参数 |
|------|------|----------|
| `checkout` | 切换到任务分支 | `id` |
| `status` | 查看分支状态 | 无 |
| `create` | 创建任务分支 | `id` |
| `delete` | 删除任务分支 | `id` |
| `merge` | 合并任务分支 | `id` |
| `push` | 推送任务分支到远程 | `id` |
| `sync` | 同步分支信息 | 无 |

## AI 使用建议

当 AI 需要管理任务与 Git 分支的关联时：

```bash
# 创建任务分支并推送
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js branch create TASK-001 --branch-name feature/new-api
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js branch push TASK-001

# 查看分支状态
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js branch status

# 合并完成的任务
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js branch merge TASK-001 --message "完成API功能"
```

## 注意事项

1. 需要先执行 `setup` 初始化项目环境
2. 项目必须是 Git 仓库
3. `create` 操作建议提供语义化的分支名称
4. `merge` 操作前请确保已提交所有更改
5. `delete` 操作不可恢复，请谨慎使用
