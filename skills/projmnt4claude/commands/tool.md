---
description: "管理本地 skill (list/create/install/remove/deploy/undeploy)"
argument-hint: "<action> [name] [-j] [-s <source>]"
---

# 管理本地 Skill

管理项目的本地 skill 工具箱。

## 执行方式

```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js tool <action> [name] [options]
```

## 选项

| 选项 | 描述 |
|------|------|
| `-j, --json` | 以 JSON 格式输出（仅 list 操作） |
| `-s, --source <source>` | 来源 URL（仅 install 操作） |

## 操作说明

### list - 列出所有 skill

列出项目中已安装的所有本地 skill。

```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js tool list
```

以 JSON 格式输出：

```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js tool list --json
```

### create - 创建新 skill

交互式创建一个新的本地 skill。

```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js tool create
```

### install - 安装 skill

从指定来源安装 skill。

```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js tool install --source <url>
```

或通过名称安装：

```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js tool install <name>
```

**参数:**
- `--source <url>` 或 `<name>` (必填) - skill 的来源 URL 或名称

### remove - 移除 skill

移除已安装的本地 skill。

```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js tool remove <name>
```

**参数:**
- `name` (必填) - 要移除的 skill 名称

### deploy - 部署 skill

部署指定的本地 skill。

```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js tool deploy <name>
```

**参数:**
- `name` (必填) - 要部署的 skill 名称

### undeploy - 取消部署 skill

取消部署指定的本地 skill。

```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js tool undeploy <name>
```

**参数:**
- `name` (必填) - 要取消部署的 skill 名称

## 支持的操作

| 操作 | 描述 | 必填参数 |
|------|------|----------|
| `list` | 列出所有已安装的 skill | 无 |
| `create` | 交互式创建新 skill | 无 |
| `install` | 从来源安装 skill | `--source <url>` 或 `<name>` |
| `remove` | 移除已安装的 skill | `name` |
| `deploy` | 部署 skill | `name` |
| `undeploy` | 取消部署 skill | `name` |

## 使用场景

- 查看项目可用的本地 skill
- 创建自定义 skill 扩展项目功能
- 从远程仓库安装社区 skill
- 管理 skill 的部署状态

## AI 使用建议

当 AI 需要管理本地 skill 时：

```bash
# 查看所有 skill（JSON 格式）
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js tool list --json

# 安装 skill
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js tool install --source <url>

# 部署 skill
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js tool deploy <name>
```

## 注意事项

1. 需要先执行 `setup` 初始化项目环境
2. skill 安装在 `.projmnt4claude/toolbox/` 目录下
3. `create` 为交互式操作，会引导完成 skill 创建
4. `install` 需要提供有效的来源 URL 或 skill 名称
