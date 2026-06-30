---
description: "管理执行计划 - 查看、添加、移除、推荐计划"
argument-hint: "<action> [id] [options]"
---

# plan - 执行计划管理

管理任务执行计划，支持查看、添加、移除、智能推荐。

## 执行方式

```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js plan <action> [options]
```

## 可用操作

| 操作 | 描述 | 示例 |
|------|------|------|
| `show` | 显示当前计划 | `plan show` |
| `add` | 添加任务到计划 | `plan add TASK-001 --after TASK-000` |
| `remove` | 从计划移除任务 | `plan remove TASK-001` |
| `clear` | 清空计划 | `plan clear --force` |
| `recommend` | 智能推荐计划 | `plan recommend` |

## 选项速查

| 选项 | 说明 |
|------|------|
| `-j, --json` | JSON 格式输出（AI 推荐） |
| `-f, --force` | 跳过确认 (clear) |
| `-a, --after <id>` | 在指定任务后添加 (add) |
| `-y, --yes` | 非交互模式，自动应用推荐（AI 推荐） |
| `-q, --query <query>` | 用户描述/关键字过滤（AI 推荐） |
| `--all` | 显示全部状态任务，默认仅推荐 open |

## 详细文档

完整使用说明请参考: `skills/projmnt4claude/commands/plan.md`
