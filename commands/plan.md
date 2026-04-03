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
| `recommend` | 智能推荐计划 | `plan recommend` |

## 选项

| 选项 | 描述 | 推荐场景 |
|------|------|----------|
| `-j, --json` | JSON 格式输出 (show/recommend) | **AI 推荐** |
| `-f, --force` | 跳过确认 (clear) | 用户/AI |
| `-a, --after <id>` | 在指定任务后添加 (add) | 用户 |
| `-y, --yes` | 非交互模式，自动应用推荐 (recommend) | **AI 推荐** |
| `-q, --query <query>` | 用户描述/关键字过滤 (recommend) | **AI 推荐** |
| `--all` | 显示全部状态任务，默认仅推荐 open (recommend) | 用户/AI |

## 推荐算法说明

`plan recommend` 使用任务链分析算法自动生成最优执行计划：

### 算法流程

1. **任务收集** - 获取所有任务，默认仅推荐 `open` 状态，`--all` 包含非终态任务
2. **关键字过滤** - 使用 `--query` 时，从描述中提取关键字并过滤匹配任务
3. **可执行性过滤** - 排除依赖未完成的任务
4. **任务链分析** - 通过 DFS 遍历依赖图，识别所有任务链（不限链数）
5. **链排序** - 按以下优先级排序：
   - 优先级升序（P0 最先）
   - 链长度降序（同优先级下长链优先）
   - 重开次数降序（频繁重开的链优先）
6. **批次分组** - 按优先级分桶构建执行批次，同批次内的不同链标记为可并行

### 关键特性

- **全量推荐**：推荐所有匹配任务，不限制数量
- **不限链数**：分析所有依赖链，不论链的长度和数量
- **批次并行**：同一优先级的不同链可并行执行
- **关键字过滤**：支持中英文关键字匹配（`--query`）
