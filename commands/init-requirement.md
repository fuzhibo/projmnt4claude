---
description: "从自然语言需求描述创建任务 - 必须让CLI完成整个创建流程，确保任务持久化到.projmnt4claude目录"
argument-hint: "<description>"
---

# init-requirement - 自然语言需求创建任务

从自然语言描述自动分析并创建结构化任务。无需手动填写表单，一句话即可完成需求到任务的转换。

## 重要：任务持久化要求

**此命令必须完成整个流程，确保任务被持久化到 `.projmnt4claude/tasks/` 目录。**

执行此命令后：
1. CLI 会显示需求分析结果（自动提取优先级、角色、复杂度、检查点）
2. CLI 会询问用户确认（非交互模式自动确认）
3. CLI 会创建任务文件（meta.json 和 checkpoint.md）
4. CLI 会询问是否添加到执行计划

**禁止行为**：
- 不要在获取分析结果后直接在上下文中规划执行
- 不要跳过 CLI 的交互式确认步骤

**正确行为**：
- 让 CLI 完成整个创建流程
- 创建完成后，可从 `.projmnt4claude/tasks/` 读取任务信息

## 前提条件

运行此命令前，需要先初始化项目：
```bash
projmnt4claude setup
```

## 执行方式

### 交互模式（默认，适合人工使用）
```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js init-requirement "<需求描述>"
```
交互模式会逐步引导你确认分析结果、编辑标题/描述/优先级/角色，并选择是否添加到执行计划。

### 非交互模式（推荐 AI 使用）
```bash
# 使用 -y 或 --yes 跳过所有确认，直接使用分析结果创建任务
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js init-requirement -y "<需求描述>"

# 同时跳过添加到计划的询问
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js init-requirement -y --no-plan "<需求描述>"
```

## 选项速查

| 选项 | 说明 |
|------|------|
| `-y, --yes` | 非交互模式：跳过所有确认 |
| `--no-plan` | 创建任务后不询问是否添加到执行计划 |
| `--skip-validation` | 跳过 checkpoint 质量校验（不推荐） |
| `--template <type>` | 描述模板类型: simple (默认) 或 detailed |
| `--no-ai` | 禁用 AI 增强，仅使用规则引擎分析 |

## 详细文档

完整使用说明请参考: `skills/projmnt4claude/commands/init-requirement.md`
