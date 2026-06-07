---
description: "从自然语言需求生成结构化调查报告 - 支持新建调查、交互评审、反馈修正、报告拆分等多种模式"
argument-hint: "[description] | --interactive | --feedback | --review | --split"
---

# investigation-requirement - 需求调查指令

从自然语言需求描述生成结构化调查报告，支持 AI 评审闭环和报告拆分。

## 运行模式

此命令支持五种运行模式：

1. **新建调查（默认）**：生成调查报告并进行 AI 评审
2. **交互模式** (`--interactive`)：与用户评审反馈循环
3. **反馈修正** (`--feedback`)：基于反馈修正已有报告
4. **评审模式** (`--review`)：仅评审已有报告
5. **拆分模式** (`--split`)：对过大报告进行拆分

## 前提条件

运行此命令前，需要先初始化项目：
```bash
projmnt4claude setup
```

## 执行方式

### 新建调查（默认）
```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js investigation-requirement "分析登录模块性能问题"
```

### 交互模式
```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js investigation-requirement --interactive "调查支付流程瓶颈"
```

### 反馈修正模式
```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js investigation-requirement --feedback --report-path ./investigation/report.md
```

### 评审模式
```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js investigation-requirement --review --report-path ./investigation/report.md
```

### 拆分模式
```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js investigation-requirement --split --report-path ./investigation/report.md
```

## 命令选项

| 选项 | 说明 |
|------|------|
| `-y, --yes` | 非交互模式 |
| `--interactive` | 交互模式：与用户评审循环 |
| `--feedback` | 反馈修正模式 |
| `--review` | 评审模式 |
| `--split` | 拆分模式 |
| `--report-path <path>` | 已有报告路径（feedback/review/split 必需） |
| `--file <path>` | 从文件读取需求描述 |
| `--output-dir <path>` | 输出目录 |
| `--output-file <path>` | 输出文件路径 |
| `--max-retry <n>` | 最大重试次数（默认 3） |
| `--split-threshold <kb>` | 拆分阈值（默认 20 KB） |
| `--language <lang>` | 语言（zh/en） |
| `--skip-review` | 跳过 AI 评审 |
| `--skip-split` | 跳过拆分 |
| `-f, --force` | 强制覆盖 |
| `--json` | JSON 输出 |
| `-q, --quiet` | 静默模式 |

## 输出格式

调查报告包含 5 大章节：

1. **问题现象**：描述观察到的问题
2. **调查发现**：详细的调查结果
3. **根因分析**：问题的根本原因
4. **影响评估**：问题和解决方案的影响
5. **解决方案**：建议的解决方案

## 使用示例

### 创建性能调查报告
```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js investigation-requirement -y "分析用户登录响应时间过长的问题"
```

### 创建架构调查报告
```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js investigation-requirement -y "调查微服务间通信延迟问题"
```

### 交互式调查
```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js investigation-requirement --interactive "调查数据库连接池泄漏"
```

### 评审已有报告
```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js investigation-requirement --review --report-path docs/investigation/login-issue/report.md
```

### 拆分过大报告
```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js investigation-requirement --split --report-path docs/investigation/big-report/report.md
```

## 提示词模板

| 模板名称 | 用途 |
|---------|------|
| `investigate` | 调查主模板 |
| `investigateWithFeedback` | 反馈修正模板 |
| `review` | 评审模板 |
| `split` | 拆分模板 |
| `splitReview` | 拆分审核模板 |

## 输出文件

报告默认输出到 `docs/investigation/{topic}/report.md`，可通过 `--output-dir` 或 `--output-file` 自定义。

## 常见问题

**Q: 提示"项目未初始化"怎么办？**
A: 先运行 `projmnt4claude setup` 初始化项目管理目录。

**Q: 报告太大怎么办？**
A: 使用 `--split` 模式自动拆分，或调整 `--split-threshold` 阈值。

**Q: 如何修改已生成的报告？**
A: 使用 `--feedback --report-path` 模式基于反馈修正。
