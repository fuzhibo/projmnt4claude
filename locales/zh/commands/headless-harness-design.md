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
| `--skip-harness-gate` | 跳过 Harness 执行前质量门禁检查（不推荐，`--skip-quality-gate` 为向后兼容别名） | false |
| `--batch-git-commit` | 每个批次完成后自动 git commit | false |

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

3. **代码审核阶段** - 独立代码审核，检查代码质量和规范

4. **QA 验证阶段** - 自动化测试和功能验证

5. **评估阶段** - 最终评估是否满足验收标准

6. **生成报告** - 输出执行摘要

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

### 批次自动提交
```bash
projmnt4claude headless-harness-design --batch-git-commit
```

启用后，每个批次完成时会自动执行 `git add -A` + `git commit`，commit message 包含批次标签和统计信息。配合 `--dry-run` 可预览提交行为。

### 批次提交追溯

启用 `--batch-git-commit` 后，每个批次完成时会自动创建 git commit，形成可追溯的执行历史：

- **Commit 格式**: `harness: 批次 N 完成 (X 通过, Y 失败, Z 文件变更)`
- **追溯方式**: 使用 `git log --oneline | grep "harness:"` 查看所有批次提交
- **批次内容**: 每个 commit 包含该批次所有任务的文件变更
- **中断安全**: `--continue` 恢复时不会重复提交已完成批次的变更
- **Dry-run 预览**: 配合 `--dry-run` 可预览提交行为，不实际执行

## 输出

执行完成后生成：

- `.projmnt4claude/reports/harness/summary-{timestamp}.md` - 执行摘要
- `.projmnt4claude/reports/harness/{taskId}/dev-report.md` - 开发报告
- `.projmnt4claude/reports/harness/{taskId}/review-report.md` - 审查报告

## AI 行为指南

### 质量门禁（重要）

**不要使用 `--skip-harness-gate`（或已弃用的 `--skip-quality-gate`）**。

`init-requirement` 创建任务时已集成质量检查（`checkQualityGate`），会显示质量评分并在质量不达标时给出改进建议。任务经过创建阶段的质量验证后，harness 执行前的质量门禁通常可以正常通过。

只有在明确收到用户指示时才使用 `--skip-harness-gate`。

## 注意事项

1. **自动计划**: 不指定 `--plan` 时会自动读取或生成计划
2. **Headless Claude**: 需要系统安装 `claude` CLI 并配置好认证
3. **超时设置**: 复杂任务可能需要更长的超时时间
4. **并行执行**: 目前仅支持串行（parallel=1）
5. **质量门禁**: 使用 `--require-quality` 设置最低质量分阈值，低于阈值的任务将被标记为失败
6. **批次提交**: 启用 `--batch-git-commit` 后，每个批次完成时自动 git commit。commit message 格式：`harness: 批次 N 完成 (X 通过, Y 失败, Z 文件变更)`。`--continue` 恢复时不会重复提交已完成批次的变更
7. **状态文件**: `harness-status.json` 记录流水线状态，启用批次模式时会追踪批次边界和进度。批次提交失败不影响流水线继续执行
