---
description: "显示命令使用说明 - 无参数显示整体帮助，命令名显示详细帮助，其他参数智能回答"
argument-hint: "[command|topic]"
---

# 帮助命令

显示项目管理命令的使用说明和帮助信息。

## 执行方式

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/projmnt4claude/dist/projmnt4claude.js help [command|topic]
```

## 使用方式

### 1. 显示整体帮助
无参数时显示所有可用命令的简要说明：

```bash
help
```

### 2. 显示特定命令帮助
指定命令名显示该命令的详细说明：

```bash
help status
help task
help help
```

### 3. 智能问答
指定任意主题获取相关解答：

```bash
help how to create task
help task dependencies
help project status
```

## 支持的命令

| 命令 | 描述 | 帮助示例 |
|------|------|----------|
| `status` | 显示项目状态摘要 | `help status` |
| `task` | 管理项目任务 | `help task` |
| `help` | 显示帮助信息 | `help help` |

## 输出格式

- **整体帮助**：命令列表 + 简要描述
- **命令帮助**：详细说明 + 使用示例 + 参数说明
- **智能问答**：基于上下文的相关解答

## 特殊功能

- 支持模糊匹配：可以输入部分命令名
- 自动补全：Tab 键补全命令名
- 链接帮助：相关命令互相链接