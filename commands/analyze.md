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

| 选项 | 描述 | 推荐场景 |
|------|------|----------|
| `--fix` | 自动修复检测到的问题 | 用户/AI |
| `-y, --yes` | 非交互模式：自动修复 | AI |
| `--compact` | 使用简洁分隔符 | AI |

## 修复操作 (--fix)

- 将孤立任务移入归档
- 将过期任务标记为 abandoned
- 对相似任务提出合并建议
- 修复配置问题
