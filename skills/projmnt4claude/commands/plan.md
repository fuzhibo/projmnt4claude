---
description: "管理执行计划 - 查看、添加、移除、推荐计划"
argument-hint: "<action> [id] [options]"
---

# 执行计划命令

管理任务执行计划。

## 执行方式

```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js plan <action> [options]
```

## 🎯 AI 行为指南

### 直接输出模式（无需 AI 处理）
当用户**仅**调用命令，没有额外提示词时，**直接输出脚本结果**：

```
用户: projmnt4claude plan show
AI: [直接输出计划内容]

用户: projmnt4claude plan recommend
AI: [直接输出推荐结果]
```

### AI 处理模式（需要进一步分析）
当用户调用命令**后跟了额外提示词**，AI 才介入处理：

```
用户: projmnt4claude plan show，我该先做哪个任务？
AI: [分析计划，推荐优先任务]

用户: projmnt4claude plan recommend，帮我分析这些任务
AI: [分析推荐计划，给出执行建议]
```

### AI 内部调用（精简模式）
AI 自主调用命令时，使用 `--json` 或 `--yes`：

```bash
projmnt4claude plan show --json           # JSON 格式
projmnt4claude plan recommend --yes       # 自动应用
projmnt4claude plan recommend --json      # 仅查看不应用
```

**重要**: 在非 TTY 环境（如 Claude Code），`recommend` 会自动跳过交互确认。

### 三层依赖推断机制

`recommend` 子命令使用三层依赖推断，逐层增强依赖识别精度：

| 层级 | 名称 | 激活条件 | 推断方式 |
|------|------|----------|----------|
| Layer1/2 | 文件路径重叠 | 默认启用 | O(n²) 比较任务对文件集合交集，时间序确定方向 |
| Layer3 | AI 语义推断 | `--smart` 激活 | AI 分析任务标题/描述语义，推断隐含功能依赖 |

**Layer3 AI 语义推断** 能识别文件重叠无法发现的依赖：
- 登录功能依赖用户模型定义
- API 端点依赖数据库 schema
- 测试任务依赖被测试的实现
- 配置模块依赖环境变量定义

**零开销保证**: 不使用 `--smart` 时，Layer3 代码路径完全跳过，不产生任何 AI 调用。

```bash
# 标准推荐（仅 Layer1/2 文件重叠推断）
projmnt4claude plan recommend

# 智能推荐（Layer1/2 + Layer3 AI 语义推断）
projmnt4claude plan recommend --smart

# 智能推荐 + JSON 输出 + 自动应用
projmnt4claude plan recommend --smart --yes --json
```

## 使用场景

### 用户直接运行（人类友好模式）
默认输出格式适合人类阅读，包含交互确认：
```bash
# 用户查看计划
projmnt4claude plan show

# 用户生成推荐计划（交互确认）
projmnt4claude plan recommend
```

### AI 调用（精简模式）
AI 调用时使用 `--json` 或 `--yes` 选项，避免交互式提示：
```bash
# AI 查看计划 - JSON 格式
projmnt4claude plan show --json

# AI 生成推荐计划 - 自动应用（非交互）
projmnt4claude plan recommend --yes

# AI 获取推荐计划 - 仅查看不应用
projmnt4claude plan recommend --json
```

## 可用操作

| 操作 | 描述 | 示例 |
|------|------|------|
| `show` | 显示当前计划 | `plan show` |
| `add` | 添加任务到计划 | `plan add TASK-001 --after TASK-000` |
| `remove` | 从计划移除任务 | `plan remove TASK-001` |
| `clear` | 清空计划 | `plan clear --force` |
| `recommend` | 智能推荐计划（三层依赖推断） | `plan recommend` / `plan recommend --smart` |

## 选项

| 选项 | 描述 | 推荐场景 |
|------|------|----------|
| `-j, --json` | JSON 格式输出 (show/recommend) | **AI 推荐** |
| `-f, --force` | 跳过确认 (clear) | 用户/AI |
| `-a, --after <id>` | 在指定任务后添加 (add) | 用户 |
| `-y, --yes` | 非交互模式，自动应用推荐 (recommend) | **AI 推荐** |
| `-q, --query <query>` | 用户描述/关键字过滤 (recommend) | **AI 推荐** |
| `--smart` | 启用 AI 语义依赖推断 Layer3 (recommend) | **AI 推荐** |
| `--all` | 显示全部状态任务，默认仅推荐 open (recommend) | 用户/AI |
