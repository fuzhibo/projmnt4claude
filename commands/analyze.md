---
description: "分析项目健康状态并可选修复问题"
argument-hint: "[--fix]"
---

# analyze - 项目分析

分析项目健康状态，检测并修复问题。

## 执行方式

```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js analyze [options]
```

## 选项速查

| 选项 | 说明 |
|------|------|
| `--fix` | 自动修复所有可修复的问题 |
| `--fix-checkpoints` | 智能生成缺失的检查点 |
| `--quality-check` | 检测任务内容质量 |
| `--deep-analyze` | 深度分析：启用 AI 语义检测 |
| `--no-ai` | 禁用 AI，仅使用规则引擎 |
| `--compact` | 精简输出（AI 推荐） |
| `-j, --json` | JSON 格式输出（AI 推荐） |
| `-y, --yes` | 非交互模式 |

## 检测项目

- 孤立任务（无依赖且无人处理）
- 循环依赖
- 状态异常的任务
- 长期未更新的任务
- 相似任务（可合并建议）
- 缺失检查点的任务
- 配置问题

## 详细文档

完整使用说明请参考: `skills/projmnt4claude/commands/analyze.md`
