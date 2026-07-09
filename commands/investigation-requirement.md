---
description: "调查/investigation - 从自然语言需求生成结构化调查报告。触发场景：(1) 用户要求调查问题、(2) 进行根因分析、(3) 分析问题根本原因、(4) investigate 某个问题、(5) root cause 分析。支持新建调查、交互评审、反馈修正、报告拆分等多种模式。"
argument-hint: "<description> | --interactive | --feedback | --review | --split"
---

# investigation-requirement - 需求调查指令

从自然语言需求描述生成结构化调查报告，支持 AI 评审闭环和报告拆分。

## 执行方式

```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js investigation-requirement "<需求描述>"
```

## 选项速查

| 选项 | 说明 |
|------|------|
| `--interactive` | 交互模式：调查完成后与用户评审反馈循环 |
| `--feedback <path>` | 反馈修正模式：基于用户反馈修正已有报告 |
| `--review <path>` | 仅评审已有报告 |
| `--split <path>` | 对过大报告进行拆分 |
| `--output-dir <path>` | 指定输出目录（默认自动生成） |
| `--output-file <path>` | 指定输出文件（单文件模式，不拆分） |
| `--max-retry <num>` | 评审失败时最大重试次数（默认 3） |
| `--split-threshold <num>` | 拆分阈值（KB），默认 20 |
| `--no-review` | 跳过 AI 评审阶段 |

## 详细文档

完整使用说明请参考: `skills/projmnt4claude/commands/investigation-requirement.md`
