---
description: "管理项目任务 - 创建、查看、更新、执行任务"
argument-hint: "<action> [id] [options]"
---

# task - 任务管理

管理 Claude Code 项目任务，支持创建、查看、更新、执行等操作。

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
| `checkpoint` | 完成检查点 | `task checkpoint TASK-001` |
| `execute` | 引导执行任务 | `task execute TASK-001` |
| `submit` | 提交任务等待验证 | `task submit TASK-001` |
| `validate` | 验证已提交的任务 | `task validate TASK-001` |
| `complete` | 一键完成任务 | `task complete TASK-001` |

## 常用选项

| 选项 | 说明 | 适用操作 |
|------|------|----------|
| `--json` | JSON 格式输出（AI 推荐） | list, show |
| `--compact` | 精简输出（AI 推荐） | show |
| `--fields <fields>` | 自定义输出字段（AI 推荐） | list |
| `--status <status>` | 按状态过滤 | list |
| `--priority <priority>` | 按优先级过滤 | list |
| `-y, --yes` | 非交互模式 | 多个操作 |

## 详细文档

完整使用说明请参考: `skills/projmnt4claude/commands/task.md`
