---
description: "管理待人工验证检查点 (list/approve/reject/batch/report)"
argument-hint: "<action> [taskId] [--checkpoint <id>] [--reason <reason>] [--feedback <feedback>]"
---

# 管理待人工验证检查点

管理任务中需要人工验证的检查点，支持查看、批准、拒绝和批量处理。

## 执行方式

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js human-verification <action> [taskId] [options]
```

## 选项

| 选项 | 描述 |
|------|------|
| `--checkpoint <id>` | 指定检查点ID（仅 approve/reject） |
| `--reason <reason>` | 拒绝原因（仅 reject） |
| `--feedback <feedback>` | 验证反馈（仅 approve/batch） |
| `--approve-all` | 批准全部待验证（仅 batch） |
| `--status <status>` | 按状态过滤: pending/approved/rejected（仅 list） |
| `--json` | JSON 格式输出（仅 list/report） |

## 操作说明

### list - 列出待验证检查点

列出待人工验证的检查点，可按状态过滤。

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js human-verification list
```

按状态过滤：

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js human-verification list --status pending
```

查看指定任务的检查点：

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js human-verification list <taskId>
```

JSON 格式输出：

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js human-verification list --json
```

**参数:**
- `taskId` (可选) - 任务ID，筛选指定任务的检查点
- `--status <status>` (可选) - 过滤状态: pending/approved/rejected
- `--json` (可选) - 以 JSON 格式输出

### approve - 批准检查点

批准指定任务的验证检查点。

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js human-verification approve <taskId>
```

批准指定检查点并附加反馈：

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js human-verification approve <taskId> --checkpoint <id> --feedback "确认通过"
```

**参数:**
- `taskId` (必填) - 任务ID
- `--checkpoint <id>` (可选) - 指定检查点ID
- `--feedback <text>` (可选) - 验证反馈

### reject - 拒绝检查点

拒绝指定任务的验证检查点。

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js human-verification reject <taskId>
```

拒绝指定检查点并说明原因：

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js human-verification reject <taskId> --checkpoint <id> --reason "代码质量不达标"
```

**参数:**
- `taskId` (必填) - 任务ID
- `--checkpoint <id>` (可选) - 指定检查点ID
- `--reason <text>` (可选) - 拒绝原因

### batch - 批量处理验证

批量处理所有待验证检查点。

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js human-verification batch --approve-all
```

批量批准并附加反馈：

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js human-verification batch --approve-all --feedback "批量确认通过"
```

**参数:**
- `--approve-all` (可选) - 批准全部待验证检查点
- `--feedback <text>` (可选) - 批量处理反馈

### report - 查看验证报告

生成并显示人工验证的整体报告。

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js human-verification report
```

JSON 格式输出：

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js human-verification report --json
```

**参数:**
- `--json` (可选) - 以 JSON 格式输出

## 支持的操作

| 操作 | 描述 | 必填参数 |
|------|------|----------|
| `list` | 列出待验证检查点 | 无 |
| `approve` | 批准检查点 | `taskId` |
| `reject` | 拒绝检查点 | `taskId` |
| `batch` | 批量处理验证 | 无 |
| `report` | 查看验证报告 | 无 |

## AI 使用建议

当 AI 需要处理人工验证检查点时：

```bash
# 查看待验证列表
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js human-verification list --status pending

# 批准指定检查点
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js human-verification approve TASK-001 --checkpoint cp-1 --feedback "确认通过"

# 拒绝并说明原因
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js human-verification reject TASK-002 --reason "需要重构"

# 查看验证报告
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js human-verification report
```

## 注意事项

1. 需要先执行 `setup` 初始化项目环境
2. `approve` 和 `reject` 操作需要指定任务ID
3. `reject` 操作建议提供拒绝原因以便后续改进
4. `batch --approve-all` 会批准所有待验证项，请谨慎使用
5. 验证状态包括: pending（待验证）、approved（已批准）、rejected（已拒绝）
