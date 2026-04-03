---
description: "管理执行计划 - 查看、添加、移除、推荐计划"
argument-hint: "<action> [id] [options]"
---

# 执行计划命令

管理任务执行计划。

## 执行方式

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js plan <action> [options]
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

- `-j, --json` - JSON 格式输出 (show/recommend)
- `-f, --force` - 跳过确认 (clear)
- `-a, --after <id>` - 在指定任务后添加 (add)
- `-y, --yes` - 非交互模式，自动应用推荐 (recommend)
- `-q, --query <query>` - 用户描述/关键字过滤 (recommend)
- `--all` - 显示全部状态任务，默认仅推荐 open (recommend)

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
