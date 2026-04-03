---
description: "Harness Design 模式执行 - 自动化任务开发与审查流程"
argument-hint: "[options]"
---

# headless-harness-design 命令

使用 Harness Design 模式自动执行任务计划。

## 执行方式

```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js headless-harness-design [options]
```

## 🎯 AI 行为指南

### 流水线状态查询

在执行过程中或执行完成后，你可以通过以下方式查询流水线状态：

```bash
# 查询当前流水线状态
cat .projmnt4claude/harness-status.json

# 使用 jq 格式化输出
jq '.' .projmnt4claude/harness-status.json

# 只看当前阶段
jq '.currentPhase' .projmnt4claude/harness-status.json

# 只看进度
jq '.progress' .projmnt4claude/harness-status.json
```

**状态字段说明**：
- `state`: 流水线状态（idle/running/completed/failed）
- `currentPhase`: 当前阶段（development/code_review/qa_verification/evaluation）
- `progress`: 进度百分比（0-100）
- `message`: 状态消息
- `phaseHistory`: 阶段历史时间线

**用户询问进度时**：直接读取状态文件并给出报告。

### 触发场景
当用户提到以下关键词时使用此命令：
- "帮我执行任务"
- "自动完成这些任务"
- "用 harness 模式执行"
- "批量处理任务"

### 推荐调用方式

**方式1：单步操作（推荐）**
```bash
projmnt4claude headless-harness-design
```
自动读取现有计划或生成新计划并执行。

**方式2：带选项调用**
```bash
projmnt4claude headless-harness-design --dry-run
projmnt4claude headless-harness-design --max-retries 5
```

**方式3：指定计划文件（向后兼容）**
```bash
projmnt4claude headless-harness-design --plan plan.json
```

### AI 内部调用
AI 自主调用时，使用 `--json` 获取结构化输出：
```bash
projmnt4claude headless-harness-design --json
```

## 工作流程

命令执行时会自动：

1. **加载计划** - 按以下优先级：
   - 优先级1: `--plan` 指定的文件（如果提供）
   - 优先级2: 读取 `.projmnt4claude/current-plan.json`
   - 优先级3: 自动调用 `plan recommend` 生成

2. **开发阶段** - 对每个任务执行开发工作

3. **审查阶段** - 独立验证开发结果

4. **生成报告** - 输出执行摘要

## 使用场景

### 场景1：直接执行（推荐）

用户说 "帮我执行这些任务"：
```bash
projmnt4claude headless-harness-design
```

### 场景2：先规划后执行

用户说 "帮我推荐执行计划" 然后 "按这个计划执行"：
```bash
# 第一步：生成计划（自动保存到 .projmnt4claude/current-plan.json）
projmnt4claude plan recommend

# 第二步：执行计划
projmnt4claude headless-harness-design
```

### 场景3：试运行

用户说 "预览一下执行流程"：
```bash
projmnt4claude headless-harness-design --dry-run
```

### 场景4：继续中断的执行

用户说 "继续之前的执行"：
```bash
projmnt4claude headless-harness-design --continue
```

### 场景5：调整参数

用户说 "重试次数多一点" 或 "超时时间长一点"：
```bash
projmnt4claude headless-harness-design --max-retries 5 --timeout 600
```

## 选项

| 选项 | 描述 | 默认值 |
|------|------|--------|
| `--plan <file>` | 计划文件（可选） | 自动读取/生成 |
| `--max-retries <n>` | 最大重试次数 | 3 |
| `--timeout <seconds>` | 单任务超时 | 300 |
| `--parallel <n>` | 并行执行数 | 1 |
| `--dry-run` | 试运行模式 | false |
| `--continue` | 从中断处继续 | false |
| `--json` | JSON 格式输出 | false |
| `--api-retry-attempts <n>` | API 调用重试次数（针对 429/500 错误） | 3 |
| `--api-retry-delay <seconds>` | API 重试基础延迟（秒） | 60 |
| `--require-quality <n>` | 质量门禁：最低质量分阈值（0-100） | 60 |
| `--skip-quality-gate` | 跳过质量门禁检查（不推荐） | false |

## 输出

执行完成后生成：

- `.projmnt4claude/reports/harness/summary-{timestamp}.md` - 执行摘要
- `.projmnt4claude/reports/harness/{taskId}/dev-report.md` - 开发报告
- `.projmnt4claude/reports/harness/{taskId}/review-report.md` - 审查报告

## Harness Design 模式说明

此命令基于 Anthropic 的 Harness Design 模式实现：

1. **Planner（规划者）**: 解析/生成任务执行列表
2. **Generator（开发者）**: 执行任务实现，生成代码变更
3. **Evaluator（评估者）**: 独立审查开发结果，判断是否满足验收标准

### 关键特性

- **上下文隔离**: 开发者和评估者使用独立的 Claude 会话
- **Sprint Contract**: 预定义验收标准，避免主观判断
- **自动重试**: 失败任务自动重试（可配置次数）
- **证据收集**: 自动收集执行证据

## 注意事项

1. **自动计划**: 不指定 `--plan` 时会自动读取或生成计划
2. **Headless Claude**: 需要系统安装 `claude` CLI 并配置好认证
3. **超时设置**: 复杂任务可能需要更长的超时时间
4. **并行执行**: 目前仅支持串行（parallel=1）
5. **中断恢复**: 使用 `--continue` 从上次中断处恢复

## 故障排除

| 错误 | 原因 | 解决方案 |
|------|------|----------|
| `项目未初始化` | 未运行 setup | 先运行 `projmnt4claude setup` |
| `没有可执行的任务` | 项目中无任务 | 确保有 open 状态的任务 |
| `开发阶段超时` | 任务复杂度高 | 增加 `--timeout` 参数 |
