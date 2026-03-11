---
description: "管理执行计划 - 查看、添加、移除、推荐计划"
argument-hint: "<action> [id] [options]"
---

# 执行计划命令

管理任务执行计划。

## 执行方式

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js plan <action> [options]
```

## 可用操作

| 操作 | 描述 | 示例 |
|------|------|------|
| `show` | 显示当前计划 | `plan show` |
| `add` | 添加任务到计划 | `plan add TASK-001 --after TASK-000` |
| `remove` | 从计划移除任务 | `plan remove TASK-001` |
| `clear` | 清空计划 | `plan clear --force` |
| `recommend` | 智能推荐计划 | `plan recommend` |

## 选项

- `--json` - JSON 格式输出 (show)
- `--after <id>` - 在指定任务后添加 (add)
- `--force` - 跳过确认 (clear)
