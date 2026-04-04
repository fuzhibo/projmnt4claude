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
| `recommend` | 智能推荐计划（三层依赖推断） | `plan recommend` / `plan recommend --smart` |

## 选项

- `-j, --json` - JSON 格式输出 (show/recommend)
- `-f, --force` - 跳过确认 (clear)
- `-a, --after <id>` - 在指定任务后添加 (add)
- `-y, --yes` - 非交互模式，自动应用推荐 (recommend)
- `-q, --query <query>` - 用户描述/关键字过滤 (recommend)
- `--smart` - 启用 AI 语义依赖推断 Layer3 (recommend)
- `--all` - 显示全部状态任务，默认仅推荐 open (recommend)

## 推荐算法说明

`plan recommend` 使用三层依赖推断 + 任务链分析算法自动生成最优执行计划：

### 三层依赖推断

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

### 算法流程

1. **任务收集** - 获取所有任务，默认仅推荐 `open` 状态，`--all` 包含非终态任务
2. **关键字过滤** - 使用 `--query` 时，从描述中提取关键字并过滤匹配任务
3. **可执行性过滤** - 排除依赖未完成的任务
4. **任务链分析** - 通过 DFS 遍历依赖图，识别所有任务链（不限链数）
5. **AI 语义推断** - `--smart` 时调用 AI 分析任务间语义依赖（Layer3）
6. **链排序** - 按以下优先级排序：
   - 优先级升序（P0 最先）
   - 架构层级升序（同优先级下 Layer0 基础层优先）
   - 链长度降序（同层级下长链优先）
   - 重开次数降序（频繁重开的链优先）
7. **批次分组** - 按优先级分桶构建执行批次，同批次内的不同链标记为可并行

### 关键特性

- **全量推荐**：推荐所有匹配任务，不限制数量
- **不限链数**：分析所有依赖链，不论链的长度和数量
- **批次并行**：同一优先级的不同链可并行执行
- **关键字过滤**：支持中英文关键字匹配（`--query`）
- **三层推断**：Layer1/2 文件重叠 + Layer3 AI 语义（`--smart` 激活）

### 示例

```bash
# 标准推荐（仅 Layer1/2 文件重叠推断）
projmnt4claude plan recommend

# 智能推荐（Layer1/2 + Layer3 AI 语义推断）
projmnt4claude plan recommend --smart

# 智能推荐 + JSON 输出 + 自动应用
projmnt4claude plan recommend --smart --yes --json
```
