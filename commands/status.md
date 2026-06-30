---
description: "显示项目状态摘要 - 任务统计、阻塞任务、最近完成"
argument-hint: "[options]"
---

# status - 项目状态摘要

显示项目当前状态摘要：任务状态分布、优先级分布、阻塞任务、最近完成任务、健康状态。

## 执行方式

```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js status [options]
```

## 选项速查

| 选项 | 说明 |
|------|------|
| `--archived` | 显示归档任务统计 |
| `-a, --all` | 显示所有任务（包括归档） |
| `-q, --quiet` | 精简输出：仅显示关键指标（AI 推荐） |
| `--json` | JSON 格式输出（AI 推荐） |
| `--compact` | 使用简洁分隔符 |

## 详细文档

完整使用说明请参考: `skills/projmnt4claude/commands/status.md`
