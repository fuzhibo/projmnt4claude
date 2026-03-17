---
description: "显示项目状态摘要 - 任务统计、阻塞任务、最近完成"
argument-hint: "[options]"
---

# 项目状态命令

显示项目当前状态摘要。

## 执行方式

```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js status [options]
```

## 🎯 使用场景

### 用户直接运行（人类友好模式）
默认输出格式适合人类阅读，包含完整的统计和健康指标：
```bash
# 用户查看完整状态报告
projmnt4claude status

# 用户查看包含归档任务的状态
projmnt4claude status --archived
```

### AI 调用（精简模式）
AI 调用时应使用 `--quiet` 或 `--json` 选项，减少上下文消耗：
```bash
# AI 快速获取状态 - 单行输出 (约 100 bytes)
projmnt4claude status --quiet
# 输出: 35 tasks | 6 open | 1 in_progress | 28 done | health: 🟢 85/100

# AI 获取结构化数据 - JSON 格式
projmnt4claude status --json
# 输出: {"total": 35, "byStatus": {...}, "healthScore": 85, ...}
```

**注意**: `status` 和 `analyze` 命令职责已分离：
- `status` - 任务统计和健康指标
- `analyze` - 问题分析和建议

## 输出内容

- 任务状态分布（open/in_progress/resolved/blocked）
- 优先级分布
- 阻塞任务列表
- 最近完成的任务
- 当前执行计划摘要
- 项目健康状态提示

## 选项

| 选项 | 描述 | 推荐场景 |
|------|------|----------|
| `--archived` | 显示归档任务统计 | 用户 |
| `-a, --all` | 显示所有任务（包括归档） | 用户 |
| `-q, --quiet` | 精简输出：仅显示关键指标 | **AI 推荐** |
| `--json` | JSON 格式输出 | **AI 推荐** |
| `--compact` | 使用简洁分隔符 | AI |

## 示例

```bash
# 完整状态报告 (用户)
projmnt4claude status

# 精简输出 (AI 推荐)
projmnt4claude status --quiet
# 输出: 35 tasks | 6 open | 1 in_progress | 28 done | health: 🟢 85/100

# JSON 格式输出 (AI 推荐)
projmnt4claude status --json

# 包含归档任务
projmnt4claude status --archived
```
