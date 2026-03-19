# CLAUDE.md - AI 使用指南

> 本文档为 AI 助手（如 Claude）提供 projmnt4claude 工具的正确使用指南。

## ⚠️ 重要原则

### 禁止直接修改 meta.json

**永远不要直接编辑 `tasks/*/meta.json` 文件！**

原因：
1. **工作流绕过**: 命令执行时会触发内部工作流（历史记录、依赖检查、状态同步等）
2. **数据不一致**: 直接修改会跳过验证逻辑，导致数据损坏
3. **审计缺失**: 历史记录和变更追踪将无法正常工作
4. **副作用丢失**: 子任务同步、检查点验证等自动处理将被跳过

### 正确做法

```bash
# ✅ 正确: 使用命令
projmnt4claude task update TASK-xxx --status in_progress

# ❌ 错误: 直接修改文件
# 不要这样做！
```

---

## AI 优化模式

### 全局选项

| 选项 | 说明 |
|------|------|
| `--ai` | AI 模式: 自动启用 JSON 输出 + 非交互模式 + 精简日志 |
| `--json` | JSON 格式输出，便于解析 |

### 使用示例

```bash
# AI 模式创建任务（返回 JSON）
projmnt4claude --ai task create --title "新功能" --type feature --priority P1

# JSON 格式列出任务
projmnt4claude --json task list --status open

# 查看任务详情
projmnt4claude --json task show TASK-xxx

# 更新任务状态
projmnt4claude task update TASK-xxx --status in_progress

# 分析项目
projmnt4claude --json analyze
```

---

## 命令参考

### task 命令

```bash
# 创建任务
projmnt4claude task create --title "标题" --type <bug|feature|research|docs|refactor|test> --priority <P0|P1|P2|P3>

# 列出任务
projmnt4claude task list [--status <status>] [--priority <priority>] [--json]

# 查看任务详情
projmnt4claude task show <taskId> [--verbose] [--json]

# 更新任务
projmnt4claude task update <taskId> --status <status> [--priority <priority>] [--title <title>]

# 删除任务（归档）
projmnt4claude task delete <taskId>

# 添加依赖
projmnt4claude task dependency add <taskId> --dep-id <depId>

# 添加子任务
projmnt4claude task add-subtask <parentId> <title>

# 拆分任务
projmnt4claude task split <taskId> --into <count>

# 搜索任务
projmnt4claude task search <keyword>

# 批量更新
projmnt4claude task batch-update --status <status> --all

# 完成任务
projmnt4claude task complete <taskId>
```

### plan 命令

```bash
# 显示当前计划
projmnt4claude plan show [--json]

# 添加任务到计划
projmnt4claude plan add <taskId>

# 从计划移除任务
projmnt4claude plan remove <taskId>

# 推荐下一个任务
projmnt4claude plan recommend [--json]
```

### analyze 命令

```bash
# 分析项目健康状态
projmnt4claude analyze [--json]

# 修复问题
projmnt4claude analyze --fix [-y]
```

### status 命令

```bash
# 显示项目状态摘要
projmnt4claude status [--json]
```

---

## JSON 输出格式

### task show

```json
{
  "id": "TASK-feature-P1-example-20260319",
  "title": "示例任务",
  "status": "open",
  "priority": "P1",
  "type": "feature",
  "description": "任务描述",
  "dependencies": [],
  "createdAt": "2026-03-19T10:00:00.000Z",
  "updatedAt": "2026-03-19T10:00:00.000Z",
  "reopenCount": 0,
  "history": []
}
```

### task list

```json
{
  "tasks": [
    { "id": "...", "title": "...", "status": "...", "priority": "..." }
  ],
  "total": 10,
  "byStatus": { "open": 5, "in_progress": 3, "closed": 2 }
}
```

### analyze

```json
{
  "issues": {
    "overdue": 0,
    "blocked": 0,
    "orphaned": 0,
    "circular": 0
  },
  "stats": {
    "total": 10,
    "byStatus": { "open": 5, "in_progress": 3 },
    "byPriority": { "P0": 1, "P1": 3, "P2": 6 }
  }
}
```

---

## 工作流示例

### 创建并执行任务

```bash
# 1. 创建任务
TASK_ID=$(projmnt4claude --ai task create --title "实现用户认证" --type feature --priority P1 | jq -r '.id')

# 2. 开始执行
projmnt4claude task update $TASK_ID --status in_progress

# 3. 完成任务
projmnt4claude task complete $TASK_ID
```

### 分析并修复问题

```bash
# 1. 分析项目
projmnt4claude --json analyze > analysis.json

# 2. 检查问题
cat analysis.json | jq '.issues'

# 3. 自动修复
projmnt4claude analyze --fix -y
```

---

## 错误处理

所有命令在错误时返回非零退出码，错误信息输出到 stderr。

```bash
if projmnt4claude task show TASK-xxx; then
  echo "任务存在"
else
  echo "任务不存在或发生错误"
fi
```

---

## 版本信息

```bash
projmnt4claude --version
```
