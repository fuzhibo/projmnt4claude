---
description: "Harness Design 模式执行 - 自动化任务开发与审查流程"
argument-hint: "[options]"
---

# headless-harness-design - Harness Design 模式执行

使用 Harness Design 模式自动执行任务计划（开发 → 代码审核 → QA 验证 → 评估）。

## 执行方式

```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js headless-harness-design [options]
```

## 选项速查

| 选项 | 说明 |
|------|------|
| `--plan <file>` | 计划文件（可选，默认自动读取/生成） |
| `--max-retries <n>` | 最大重试次数（默认 3） |
| `--timeout <seconds>` | 单任务超时（默认 300） |
| `--dry-run` | 试运行模式 |
| `--continue` | 从中断处继续 |
| `--json` | JSON 格式输出 |
| `--batch-git-tag-commit` | 每个批次完成后自动 git commit + tag |
| `--skip-harness-gate` | 跳过质量门禁检查（不推荐） |

## 工作流程

1. **加载计划** - 自动读取或生成执行计划
2. **开发阶段** - 对每个任务执行开发工作
3. **代码审核阶段** - 独立代码审核
4. **QA 验证阶段** - 自动化测试和功能验证
5. **评估阶段** - 最终评估是否满足验收标准
6. **生成报告** - 输出执行摘要

## 详细文档

完整使用说明请参考: `skills/projmnt4claude/commands/headless-harness-design.md`
