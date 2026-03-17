---
description: "管理执行计划 - 查看、添加、移除、推荐计划"
argument-hint: "<action> [id] [options]"
---

# 执行计划命令

管理任务执行计划。

## 执行方式

```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js plan <action> [options]
```

## 🎯 使用场景

### 用户直接运行（人类友好模式）
默认输出格式适合人类阅读，包含交互确认：
```bash
# 用户查看计划
projmnt4claude plan show

# 用户生成推荐计划（交互确认）
projmnt4claude plan recommend
```

### AI 调用（精简模式）
AI 调用时使用 `--json` 或 `--yes` 选项，避免交互式提示：
```bash
# AI 查看计划 - JSON 格式
projmnt4claude plan show --json

# AI 生成推荐计划 - 自动应用（非交互）
projmnt4claude plan recommend --yes

# AI 获取推荐计划 - 仅查看不应用
projmnt4claude plan recommend --json
```

**重要**: 在非 TTY 环境（如 Claude Code），`recommend` 会自动跳过交互确认。

## 可用操作

| 操作 | 描述 | 示例 |
|------|------|------|
| `show` | 显示当前计划 | `plan show` |
| `add` | 添加任务到计划 | `plan add TASK-001 --after TASK-000` |
| `remove` | 从计划移除任务 | `plan remove TASK-001` |
| `clear` | 清空计划 | `plan clear --force` |
| `recommend` | 智能推荐计划 | `plan recommend` |

## 选项

| 选项 | 描述 | 推荐场景 |
|------|------|----------|
| `--json` | JSON 格式输出 (show/recommend) | **AI 推荐** |
| `--after <id>` | 在指定任务后添加 (add) | 用户 |
| `--force` | 跳过确认 (clear) | 用户/AI |
| `-y, --yes` | 非交互模式，自动应用推荐 (recommend) | **AI 推荐** |
