---
description: "Harness Design 模式执行 - 自动化任务开发与审查流程"
argument-hint: "[options]"
---

# headless-harness-design 命令

使用 Harness Design 模式自动执行任务计划。

## 执行方式

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js headless-harness-design [options]
```

## 选项

| 选项 | 描述 | 默认值 |
|------|------|--------|
| `--plan <file>` | 计划文件路径（可选，不指定则自动读取/生成） | 自动读取/生成 |
| `--max-retries <n>` | 最大重试次数 | 3 |
| `--timeout <seconds>` | 单任务超时时间（秒） | 300 |
| `--parallel <n>` | 并行执行数 | 1 |
| `--dry-run` | 试运行模式（不实际执行） | false |
| `--continue` | 从上次中断处继续执行 | false |
| `--json` | JSON 格式输出 | false |
| `--api-retry-attempts <n>` | API 调用重试次数（针对 429/500 错误） | 3 |
| `--api-retry-delay <seconds>` | API 重试基础延迟（秒） | 60 |
| `--require-quality <n>` | 质量门禁：最低质量分阈值（0-100） | 60 |
| `--skip-quality-gate` | 跳过质量门禁检查（不推荐） | false |

## 流水线状态查询

在执行过程中或执行完成后，可以通过以下方式查询流水线状态：

```bash
# 查询当前流水线状态
cat .projmnt4claude/harness-status.json

# 使用 jq 格式化输出
jq '.' .projmnt4claude/harness-status.json
```

**状态字段说明**：
- `state`: 流水线状态（idle/running/completed/failed）
- `currentPhase`: 当前阶段（development/code_review/qa_verification/evaluation）
- `progress`: 进度百分比（0-100）
- `message`: 状态消息
- `phaseHistory`: 阶段历史时间线

## 工作流程

1. **加载计划** - 按以下优先级：
   - 优先级1: `--plan` 指定的文件
   - 优先级2: 读取 `.projmnt4claude/current-plan.json`
   - 优先级3: 自动调用 `plan recommend` 生成

2. **开发阶段** - 对每个任务执行开发工作

3. **审查阶段** - 独立验证开发结果

4. **生成报告** - 输出执行摘要

## 使用场景

### 直接执行（推荐）
```bash
projmnt4claude headless-harness-design
```

### 先规划后执行
```bash
projmnt4claude plan recommend
projmnt4claude headless-harness-design
```

### 试运行
```bash
projmnt4claude headless-harness-design --dry-run
```

### 继续中断的执行
```bash
projmnt4claude headless-harness-design --continue
```

### 带质量门禁
```bash
projmnt4claude headless-harness-design --require-quality 80
```

### API 重试配置
```bash
projmnt4claude headless-harness-design --api-retry-attempts 5 --api-retry-delay 30
```

## 输出

执行完成后生成：

- `.projmnt4claude/reports/harness/summary-{timestamp}.md` - 执行摘要
- `.projmnt4claude/reports/harness/{taskId}/dev-report.md` - 开发报告
- `.projmnt4claude/reports/harness/{taskId}/review-report.md` - 审查报告

## 注意事项

1. **自动计划**: 不指定 `--plan` 时会自动读取或生成计划
2. **Headless Claude**: 需要系统安装 `claude` CLI 并配置好认证
3. **超时设置**: 复杂任务可能需要更长的超时时间
4. **并行执行**: 目前仅支持串行（parallel=1）
5. **质量门禁**: 使用 `--require-quality` 设置最低质量分阈值，低于阈值的任务将被标记为失败
