---
description: "分析项目健康状态并可选修复问题"
argument-hint: "[--fix]"
---

# 项目分析命令

分析项目健康状态，检测并修复问题。

## 执行方式

```bash
# 仅分析
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js analyze

# 分析并修复
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js analyze --fix
```

## 🎯 AI 行为指南

### 直接输出模式（无需 AI 处理）
当用户**仅**调用命令，没有额外提示词时，**直接输出脚本结果**：

```
用户: projmnt4claude analyze
AI: [直接输出分析结果]

用户: projmnt4claude analyze --fix
AI: [直接输出修复结果]
```

### AI 处理模式（需要进一步分析）
当用户调用命令**后跟了额外提示词**，AI 才介入处理：

```
用户: projmnt4claude analyze，帮我修复所有问题
AI: [执行 --fix 并说明修复内容]

用户: projmnt4claude analyze，这些问题严重吗？
AI: [分析问题严重程度，给出优先级建议]
```

### AI 内部调用（精简模式）
AI 自主调用命令时，使用 `--compact` 减少输出：

```bash
projmnt4claude analyze --compact
```

## 使用场景

### 用户直接运行（人类友好模式）
默认输出包含完整的问题分析和建议：
```bash
# 用户分析项目问题
projmnt4claude analyze

# 用户自动修复问题
projmnt4claude analyze --fix
```

### AI 调用（精简模式）
AI 调用时使用 `--compact` 选项减少输出：
```bash
# AI 分析项目问题
projmnt4claude analyze --compact
```

**职责区分**:
- `status` - 任务统计和健康指标（AI 用 `--quiet` 或 `--json`）
- `analyze` - 问题分析和建议（AI 用 `--compact`）

## 检测项目

- 孤立任务（无依赖且无人处理）
- 循环依赖
- 状态异常的任务
- 长期未更新的任务
- 相似任务（可合并建议）
- 缺失检查点的任务
- 配置问题

## 选项

| 选项 | 描述 | 默认值 | 推荐场景 |
|------|------|--------|----------|
| `--fix` | 自动修复所有可修复的问题 | - | 用户/AI |
| `--fix-checkpoints` | 智能生成缺失的检查点 | - | 用户/AI |
| `--fix-verification` | 仅修复验证方法问题 (manual -> automated) | - | AI |
| `--fix-status` | 仅修复状态相关问题 (状态格式、优先级、时间戳等) | - | AI |
| `--quality-check` | 检测任务内容质量（描述完整度、检查点质量、关联文件、解决方案） | - | 用户/AI |
| `--threshold <score>` | 质量检测阈值，低于此分数的任务将被标记 | 60 | 用户/AI |
| `-j, --json` | JSON 格式输出 (仅 --quality-check) | false | AI |
| `-y, --yes` | 非交互模式：自动修复可修复的问题 | false | AI |
| `--compact` | 使用简洁分隔符 | false | AI |
| `--task <taskId>` | 指定任务ID (仅 --fix-checkpoints) | - | AI |
| `--deep-analyze` | 深度分析: 启用 AI 语义重复检测、陈旧评估、语义质量评分 | false | 用户/AI |
| `--no-ai` | 禁用所有 AI 功能，仅使用规则引擎分析 | false | 用户 |
| `--bug-report <path>` | Bug Report 分析模式: 分析指定的 bug report 文件或目录 | - | 用户/AI |
| `--export-training-data` | 导出训练数据为 JSONL 格式 (需 --bug-report, 需 config training.exportEnabled) | false | AI |

## Bug Report 分析模式

使用 `--bug-report <path>` 对指定的 bug report 文件或目录进行深度分析：

```bash
# 分析单个 bug report 文件
projmnt4claude analyze --bug-report .projmnt4claude/logs/bug-report-20260404.md

# 分析整个 bug report 目录
projmnt4claude analyze --bug-report .projmnt4claude/logs/

# 分析并导出训练数据（需先启用 training.exportEnabled）
projmnt4claude analyze --bug-report .projmnt4claude/logs/ --export-training-data
```

### 分析内容
- **问题模式识别**: 从日志中提取错误模式和异常堆栈
- **根因分析**: 结合代码上下文推断可能的根因
- **修复建议**: AI 生成针对性修复方案

### 训练数据导出
配合 `--export-training-data` 可将分析结果导出为 JSONL 格式训练数据：
- 需要在配置中启用 `training.exportEnabled`
- 导出路径由 `training.outputDir` 控制
- 数据格式为 `{ instruction, input, output }` 结构

## AI 分析功能

### --deep-analyze（深度分析）
启用 AI 语义层面的深度分析，在规则引擎分析基础上增加：
- **语义重复检测**: 通过语义相似度识别描述不同但含义重复的任务
- **陈旧评估**: AI 判断任务是否因代码库演进已过时或不再适用
- **语义质量评分**: 基于 AI 理解评估任务描述的完整性和准确性

### --no-ai（禁用 AI）
禁用所有 AI 功能，仅使用规则引擎进行模式匹配分析。适用于：
- 离线环境
- CI/CD 流水线（无需 AI 调用）
- 仅需快速结构检查

### 默认行为
不指定 `--deep-analyze` 或 `--no-ai` 时，analyze 使用规则引擎进行标准分析（孤立任务、循环依赖、状态异常等检测）。

## 修复操作

### --fix（综合修复）
- 将孤立任务移入归档
- 将过期任务标记为 abandoned
- 对相似任务提出合并建议
- 修复配置问题
- 修复旧格式优先级/状态
- 修复无效依赖引用
- 修复状态矛盾 (resolved + verification.failed)
- 修复 schema 版本过时

### --fix-checkpoints（检查点生成）
- 智能分析验收标准并搜索代码库
- 为缺少检查点的任务生成精确的检查点
- 使用 `--task <taskId>` 可针对单个任务操作

### --fix-verification（验证方法修复）
- 将 manual 验证方法替换为 automated
- 为 resolved 但缺少 verification 的任务回填字段

### --fix-status（状态修复）
- 修复旧格式状态 (pending/completed/reopen/cancelled)
- 修复旧格式优先级 (urgent/high/medium/low)
- 修复 pipeline 中间状态迁移
- 修复时间戳格式
- 修复无效 VerdictAction 值
- 修复 schema 版本过时

### --quality-check（质量检测）
- 描述完整度评分 (35% 权重)
- 检查点质量评分 (30% 权重)
- 关联文件评分 (15% 权重)
- 解决方案评分 (20% 权重)
- 使用 `--threshold` 设置低质量阈值 (默认 60)
