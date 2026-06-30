---
description: "显示命令使用说明 - 无参数显示整体帮助，命令名显示详细帮助，其他参数智能回答"
argument-hint: "[command|topic]"
---

# help - 命令帮助

显示项目管理命令的使用说明和帮助信息。支持整体帮助、特定命令帮助、智能问答三种模式。

## 执行方式

```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js help [command|topic]
```

## 使用方式

| 模式 | 说明 | 示例 |
|------|------|------|
| 整体帮助 | 显示所有可用命令 | `help` |
| 命令帮助 | 显示特定命令详细说明 | `help status` |
| 智能问答 | 基于主题的相关解答 | `help task dependencies` |

## 详细文档

完整使用说明请参考: `skills/projmnt4claude/commands/help.md`