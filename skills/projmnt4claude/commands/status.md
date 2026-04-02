---
description: "显示项目状态摘要 - 任务统计、阻塞任务、最近完成"
argument-hint: ""
---

# 项目状态命令

显示项目当前状态摘要。

## 执行方式

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js status
```

## 选项

| 选项 | 描述 |
|------|------|
| `--archived` | 显示归档任务统计 |
| `-a, --all` | 显示所有任务（包括归档） |
| `-q, --quiet` | 精简输出：仅显示关键指标 |
| `--json` | JSON 格式输出 |
| `--compact` | 使用简洁分隔符 |

## 输出内容

- 任务状态分布（open/in_progress/resolved/blocked）
- 优先级分布
- 阻塞任务列表
- 最近完成的任务
- 当前执行计划摘要
- 项目健康状态提示
