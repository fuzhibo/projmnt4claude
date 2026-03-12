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

## 可用操作

| 操作 | 描述 | 示例 |
|------|------|------|
| `create` | 交互式创建新任务 | `task create` |
| `list` | 列出所有任务 | `task list --status in_progress` |
| `show` | 显示任务详情 | `task show TASK-001` |
| `update` | 更新任务属性 | `task update TASK-001 --status resolved` |
| `delete` | 删除（归档)任务 | `task delete TASK-001` |
| `execute` | 引导执行任务 | `task execute TASK-001` |
| `checkpoint` | 完成检查点 | `task checkpoint TASK-001` |
| `dependency` | 管理依赖 | `task dependency add TASK-001 TASK-002` |

| `add-subtask` | 为父任务创建子任务 | `task add-subtask TASK-001 "实现登录功能"` |
| `help` | 显示帮助 | `task help` |

## 过滤选项 (list)
- `--status <status>` - 按状态过滤
- `--priority <priority>` - 按优先级过滤
- `--role <role>` - 按推荐角色过滤

## 更新选项 (update)
- `--title <title>` - 更新标题
- `--description <desc>` - 更新描述
- `--status <status>` - 更新状态
- `--priority <priority>` - 更新优先级

- `--dependency add <parentId> <subtaskId>` - 添加子任务依赖
- `--dependency remove <parentId> <subtaskId>` - 移除子任务依赖

- `--help` | 显示帮助信息
- `--help [topic]` - 显示帮助信息
- `--help` | 显示整体帮助
- `--help status` - 显示状态统计
- `--help priority` - 显示优先级统计
- `--help` | 显示智能问答帮助

**示例:**
```bash
# 创建子任务
projmnt4claude task add-subtask TASK-001 "实现用户登录功能"

# 查看子任务
projmnt4claude task show TASK-001-1

# 更新子任务状态
projmnt4claude task update TASK-001-1 --status in_progress
```

## 检查点 (checkpoint)

完成检查点以推进任务进度。

```bash
# 完成检查点
projmnt4claude task checkpoint TASK-001

# 验证检查点
projmnt4claude task verify-checkpoint TASK-001
```

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
